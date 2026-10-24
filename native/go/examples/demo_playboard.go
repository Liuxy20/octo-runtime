package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	octo "github.com/Mininglamp-OSS/octo-runtime/native/go"
)

const maximumInput = 32 * 1024 * 1024

func main() { os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr)) }

func run(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	if len(args) == 0 || args[0] == "help" || args[0] == "--help" {
		usage(stdout)
		return 0
	}
	command := args[0]
	flags := flag.NewFlagSet(command, flag.ContinueOnError)
	flags.SetOutput(stderr)
	endpoint := flags.String("endpoint", os.Getenv("OCTO_KERNEL_ENDPOINT"), "existing Kernel Unix socket or Windows named pipe")
	requestFile := flags.String("request", "-", "InvokeInput JSON file; - reads stdin")
	prompt := flags.String("prompt", "", "construct a text request instead of reading JSON")
	adapter := flags.String("adapter", "codex", "adapter used with --prompt")
	mode := flags.String("mode", "canonical", "native or canonical; used with --prompt")
	approval := flags.String("approval", "ask", "approval policy used with --prompt")
	timeout := flags.Duration("timeout", 0, "execution cancellation deadline, e.g. 30s; 0 disables")
	grace := flags.Duration("cancel-grace", 10*time.Second, "time to observe terminal after cancellation or drain")
	receiptFile := flags.String("receipt", "", "save original RunRef for get/subscribe/control commands")
	refFile := flags.String("ref", "", "original RunRef JSON file")
	after := flags.Int64("after", 0, "subscribe after this sequence number")
	reason := flags.String("reason", "demo_user_cancelled", "explicit cancellation reason")
	responsesFile := flags.String("responses", "", "JSON array of explicit interaction answers")
	responseFile := flags.String("response", "-", "interaction response JSON file; - reads stdin")
	if err := flags.Parse(args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if flags.NArg() != 0 {
		fmt.Fprintln(stderr, "Unexpected positional arguments")
		return 2
	}
	if *endpoint == "" {
		fmt.Fprintln(stderr, "Set --endpoint or OCTO_KERNEL_ENDPOINT to an existing Kernel endpoint.")
		return 2
	}
	if *grace <= 0 || *timeout < 0 || *after < 0 {
		fmt.Fprintln(stderr, "Invalid timeout, cancel-grace or cursor")
		return 2
	}
	client := octo.Attach(*endpoint)
	defer client.Close()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if *timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, *timeout)
		defer cancel()
	}
	write := func(v any) error {
		encoder := json.NewEncoder(stdout)
		encoder.SetEscapeHTML(false)
		return encoder.Encode(v)
	}
	fail := func(err error) int {
		var kernel *octo.Error
		if errors.As(err, &kernel) {
			fmt.Fprintln(stderr, kernel.Code)
		} else {
			fmt.Fprintln(stderr, err)
		}
		if errors.Is(err, context.Canceled) {
			return 130
		}
		if errors.Is(err, context.DeadlineExceeded) {
			return 124
		}
		return 1
	}
	switch command {
	case "status":
		value, err := client.Status(ctx)
		if err != nil {
			return fail(err)
		}
		if err = write(value); err != nil {
			return fail(err)
		}
		return 0
	case "list":
		value, err := client.List(ctx)
		if err != nil {
			return fail(err)
		}
		if err = write(value); err != nil {
			return fail(err)
		}
		return 0
	case "get", "subscribe", "cancel", "respond", "native-respond":
		data, err := readFile(*refFile, stdin)
		if err != nil {
			return fail(err)
		}
		ref, err := octo.Decode[octo.KernelRunRef]("KernelRunRef", data)
		if err != nil {
			return fail(err)
		}
		switch command {
		case "get":
			value, err := client.Get(ctx, lookup(ref), ref.KernelInstanceId)
			if err != nil {
				return fail(err)
			}
			if err = write(value); err != nil {
				return fail(err)
			}
		case "cancel":
			value, err := client.Cancel(ctx, ref, *reason)
			if err != nil {
				return fail(err)
			}
			if err = write(value); err != nil {
				return fail(err)
			}
		case "subscribe":
			stream := client.Subscribe(ctx, ref, *after)
			defer stream.Close()
			for {
				frame, err := stream.Next()
				if errors.Is(err, io.EOF) {
					break
				}
				if err != nil {
					return fail(err)
				}
				if err = write(frame); err != nil {
					return fail(err)
				}
			}
		case "respond", "native-respond":
			data, err := readFile(*responseFile, stdin)
			if err != nil {
				return fail(err)
			}
			if command == "respond" {
				reply, e := octo.Decode[octo.InteractionResponseWire]("InteractionResponseWire", data)
				if e != nil {
					return fail(e)
				}
				err = client.Respond(ctx, ref, reply)
			} else {
				reply, e := octo.Decode[octo.NativeInteractionResponse]("NativeInteractionResponse", data)
				if e != nil {
					return fail(e)
				}
				err = client.RespondNative(ctx, ref, reply)
			}
			if err != nil {
				return fail(err)
			}
			if err = write(map[string]any{}); err != nil {
				return fail(err)
			}
		}
		return 0
	case "playboard":
	default:
		fmt.Fprintf(stderr, "Unknown command %q\n", command)
		usage(stderr)
		return 2
	}
	var data []byte
	var err error
	if *prompt != "" {
		data, err = json.Marshal(map[string]any{"protocol_mode": *mode, "inputs": []any{map[string]any{"type": "text", "text": *prompt}}, "contexts": map[string]any{"schema": "octo.context-envelope/v3", "items": []any{map[string]any{"namespace": "octo.execution", "name": "adapter", "payload": map[string]any{"type": *adapter}}, map[string]any{"namespace": "octo.security", "name": "approval_policy", "payload": map[string]any{"mode": *approval}}}}})
	} else {
		data, err = readFile(*requestFile, stdin)
	}
	if err != nil {
		return fail(err)
	}
	input, err := octo.Decode[octo.InvokeInputWire]("InvokeInputWire", data)
	if err != nil {
		return fail(err)
	}
	if !input.RunId.Set {
		input.RunId = octo.Some(rand.Text())
	}
	if !input.InvocationId.Set {
		input.InvocationId = octo.Some(rand.Text())
	}
	if !input.SessionId.Set {
		input.SessionId = octo.Some(rand.Text())
	}
	expectedInstance := ""
	if *receiptFile != "" {
		status, e := client.Status(ctx)
		if e != nil {
			return fail(e)
		}
		expectedInstance = status.KernelInstanceId
	}
	requestMode := input.ProtocolMode.Value
	if !input.ProtocolMode.Set {
		requestMode = "native"
	}
	originalKey := octo.KernelLookupKey{RunId: input.RunId.Value, InvocationId: input.InvocationId.Value, AgentSessionId: input.SessionId.Value, SessionGeneration: input.SessionGeneration.Value, ProtocolMode: requestMode}
	var replies []reply
	if *responsesFile != "" {
		data, err = readFile(*responsesFile, stdin)
		if err != nil {
			return fail(err)
		}
		if err = json.Unmarshal(data, &replies); err != nil {
			return fail(err)
		}
		for _, r := range replies {
			definition := "InteractionResponseWire"
			if r.Kind == "native" {
				definition = "NativeInteractionResponse"
			} else if r.Kind != "canonical" {
				return fail(errors.New("reply.kind must be native or canonical"))
			}
			if err = octo.Validate(definition, r.Response); err != nil {
				return fail(err)
			}
		}
	}
	// Signals request execution cancellation; grace expiry only closes observation and cannot imply success.
	finished := make(chan struct{})
	defer close(finished)
	go func() {
		select {
		case <-finished:
			return
		case <-ctx.Done():
		}
		timer := time.NewTimer(*grace)
		defer timer.Stop()
		select {
		case <-finished:
		case <-timer.C:
			client.Close()
		}
	}()
	stream := client.Invoke(ctx, input, octo.KernelInvokeEnvironmentWire{})
	defer stream.Close()
	exit := 1
	saved := false
	var invokeErr error
	answered := make(map[string]bool)
	for {
		event, e := stream.Next()
		if errors.Is(e, io.EOF) {
			break
		}
		if e != nil {
			invokeErr = e
			break
		}
		records := client.Invocations()
		if !saved && *receiptFile != "" {
			var ref *octo.KernelRunRef
			if len(records) > 0 {
				ref = records[0].Ref
			}
			if ref == nil {
				snapshot, queryErr := client.Get(context.Background(), originalKey, expectedInstance)
				if queryErr != nil {
					invokeErr = queryErr
					break
				}
				ref = &snapshot.Ref
			}
			if e = saveJSON(*receiptFile, ref); e != nil {
				invokeErr = e
				break
			}
			saved = true
		}
		if e = write(event); e != nil {
			invokeErr = e
			break
		}
		var value struct {
			Kind        string `json:"kind"`
			Type        string `json:"type"`
			MessageKind string `json:"messageKind"`
			Control     struct {
				Type      string          `json:"type"`
				State     string          `json:"state"`
				Status    string          `json:"status"`
				RequestID json.RawMessage `json:"requestId"`
			} `json:"control"`
			Payload map[string]json.RawMessage `json:"payload"`
		}
		if e = json.Unmarshal(event, &value); e != nil {
			invokeErr = e
			break
		}
		if value.Kind == "control" && value.Control.Type == "state" {
			switch value.Control.State {
			case "completed":
				exit = 0
			case "cancelled":
				exit = 130
			case "failed", "lost":
				exit = 1
			}
		}
		switch value.Type {
		case "run.completed":
			exit = 0
		case "run.cancelled":
			exit = 130
		case "run.failed":
			exit = 1
		}
		interaction := value.Type == "interaction.requested" || (value.Kind == "control" && value.Control.Type == "interaction" && value.Control.Status == "pending") || (value.Kind == "native" && value.MessageKind == "request")
		if interaction {
			native := value.Kind != ""
			target := value.Payload["interactionId"]
			if native {
				target = value.Control.RequestID
				if len(target) == 0 {
					target = value.Payload["id"]
				}
			}
			// A native request can appear as request and control.pending; answer it only once.
			answerKey := fmt.Sprintf("%t:%s", native, target)
			if answered[answerKey] {
				continue
			}
			found := -1
			for n, r := range replies {
				if r.used || (r.Kind == "native") != native {
					continue
				}
				var fields map[string]json.RawMessage
				json.Unmarshal(r.Response, &fields)
				key := "interactionId"
				if native {
					key = "requestId"
				}
				if string(fields[key]) == string(target) {
					found = n
					break
				}
			}
			if found < 0 {
				fmt.Fprintln(stderr, "INTERACTION_PENDING: use respond/native-respond --ref <receipt> --response <reply.json> in another terminal; Ctrl-C cancels this run.")
				continue
			}
			if len(records) == 0 {
				invokeErr = errors.New("INVOCATION_NOT_TRACKED")
				break
			}
			invocationID := records[0].Key.InvocationId
			r := &replies[found]
			if native {
				answer, e := octo.Decode[octo.NativeInteractionResponse]("NativeInteractionResponse", r.Response)
				if e == nil {
					e = client.RespondNativeInteraction(context.Background(), invocationID, answer)
				}
				err = e
			} else {
				answer, e := octo.Decode[octo.InteractionResponseWire]("InteractionResponseWire", r.Response)
				if e == nil {
					e = client.RespondInteraction(context.Background(), invocationID, answer)
				}
				err = e
			}
			if err != nil {
				invokeErr = err
				break
			}
			r.used = true
			answered[answerKey] = true
		}
	}
	client.StopAdmission()
	// The CLI owns this invocation and cancels its unfinished run on exit; SDK Close itself does not cancel runs.
	if len(client.Invocations()) > 0 {
		result := client.Drain(context.Background(), time.Now().Add(*grace), "playboard_exit")
		if !result.Complete {
			fmt.Fprintf(stderr, "DRAIN_INCOMPLETE: %d invocation(s) remain unresolved\n", len(result.Unresolved))
			if invokeErr == nil {
				invokeErr = errors.New("RUN_OUTCOME_UNKNOWN")
			}
		}
	}
	if invokeErr != nil {
		return fail(invokeErr)
	}
	return exit
}

type reply struct {
	Kind     string          `json:"kind"`
	Response json.RawMessage `json:"response"`
	used     bool
}

func lookup(ref octo.KernelRunRef) octo.KernelLookupKey {
	return octo.KernelLookupKey{RunId: ref.RunId, InvocationId: ref.InvocationId, AgentSessionId: ref.AgentSessionId, SessionGeneration: ref.SessionGeneration, ProtocolMode: ref.ProtocolMode}
}
func readFile(path string, stdin io.Reader) ([]byte, error) {
	var r io.Reader = stdin
	if path == "" {
		return nil, errors.New("a JSON file path is required")
	}
	if path != "-" {
		file, e := os.Open(path)
		if e != nil {
			return nil, e
		}
		defer file.Close()
		r = file
	}
	body, e := io.ReadAll(io.LimitReader(r, maximumInput+1))
	if e != nil {
		return nil, e
	}
	if len(body) > maximumInput {
		return nil, errors.New("INVOKE_REQUEST_TOO_LARGE")
	}
	return body, nil
}
func saveJSON(path string, value any) error {
	body, e := json.MarshalIndent(value, "", "  ")
	if e != nil {
		return e
	}
	file, e := os.CreateTemp(filepath.Dir(path), ".receipt-*")
	if e != nil {
		return e
	}
	name := file.Name()
	defer os.Remove(name)
	if _, e = file.Write(append(body, '\n')); e != nil {
		file.Close()
		return e
	}
	if e = file.Close(); e != nil {
		return e
	}
	return os.Rename(name, path)
}
func usage(out io.Writer) {
	fmt.Fprintln(out, strings.TrimSpace(`Native Octo Runtime playground (Go)

  playboard-demo-go status|list --endpoint SOCKET
  playboard-demo-go playboard --endpoint SOCKET < request.json
  playboard-demo-go playboard --endpoint SOCKET --prompt "Reply with OK" --adapter codex
  playboard-demo-go playboard --endpoint SOCKET --request request.json --timeout 30s --receipt run.json
  playboard-demo-go get|subscribe|cancel --endpoint SOCKET --ref run.json
  playboard-demo-go respond|native-respond --endpoint SOCKET --ref run.json --response reply.json

OCTO_KERNEL_ENDPOINT supplies the default endpoint. stdout is NDJSON; stderr is diagnostic.
The Kernel must already be running. This binary does not start Node or a provider process.
Use playboard -h for options. Explicit --responses answers approvals/questions; there is no auto-approve.
`))
}

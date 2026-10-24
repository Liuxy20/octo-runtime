package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	octo "github.com/Mininglamp-OSS/octo-runtime/native/go"
	"io"
	"os"
	"sync"
	"time"
)

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 65536), 40*1024*1024)
	for scanner.Scan() {
		var request map[string]json.RawMessage
		if e := json.Unmarshal(scanner.Bytes(), &request); e != nil {
			panic(e)
		}
		answer, e := run(request)
		if e != nil {
			if answer == nil {
				answer = map[string]any{}
			}
			answer["error"] = e.Error()
			var ke *octo.Error
			if errors.As(e, &ke) {
				answer["error"] = ke.Code
			}
		}
		if e = json.NewEncoder(os.Stdout).Encode(answer); e != nil {
			panic(e)
		}
	}
	if e := scanner.Err(); e != nil {
		panic(e)
	}
}
func run(m map[string]json.RawMessage) (map[string]any, error) {
	str := func(k string) string { var s string; json.Unmarshal(m[k], &s); return s }
	out := map[string]any{}
	op := str("op")
	if op == "codec" {
		e := octo.Validate(str("definition"), m["value"])
		out["valid"] = e == nil
		if e == nil {
			out["value"] = m["value"]
		}
		return out, nil
	}
	c := octo.Attach(str("endpoint"))
	defer c.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	status, e := c.Status(ctx)
	if e != nil {
		return nil, e
	}
	out["instance"] = status.KernelInstanceId
	adapters, e := c.List(ctx)
	if e != nil {
		return nil, e
	}
	out["adapters"] = len(adapters)
	input, e := octo.Decode[octo.InvokeInputWire]("InvokeInputWire", m["input"])
	if e != nil {
		return nil, e
	}
	if op == "drain-queued-cancels" {
		var wg sync.WaitGroup
		for n := 0; n < 5; n++ {
			request := input
			id := fmt.Sprintf("%s-%d", input.InvocationId.Value, n)
			request.InvocationId = octo.Some(id)
			request.RunId = octo.Some(id)
			stream := c.Invoke(ctx, request, octo.KernelInvokeEnvironmentWire{})
			if _, e := stream.Next(); e != nil {
				stream.Close()
				return nil, e
			}
			stream.Close()
			wg.Add(1)
			go func() { defer wg.Done(); _, _ = c.CancelInvocation(ctx, id, "test_cancel") }()
		}
		gate := str("gate")
		for {
			if _, e := os.Stat(gate + ".ready"); e == nil {
				break
			}
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			time.Sleep(time.Millisecond)
		}
		out["drain"] = c.Drain(ctx, time.Now().Add(100*time.Millisecond), "test_drain")
		out["repeated"] = c.Drain(ctx, time.Now().Add(5*time.Second), "again")
		if e := os.WriteFile(gate+".drained", []byte("drained"), 0600); e != nil {
			return nil, e
		}
		wg.Wait()
		return out, nil
	}
	if op == "close-admitting" || op == "cancel-close-admitting" {
		stream := c.Invoke(ctx, input, octo.KernelInvokeEnvironmentWire{})
		done := make(chan error, 1)
		go func() { _, e := stream.Next(); done <- e }()
		gate := str("gate")
		until := time.Now().Add(5 * time.Second)
		for {
			if _, e := os.Stat(gate); e == nil {
				break
			}
			if time.Now().After(until) {
				return nil, fmt.Errorf("barrier timeout")
			}
			time.Sleep(time.Millisecond)
		}
		if op == "cancel-close-admitting" {
			cancel()
		}
		stream.Close()
		select {
		case e := <-done:
			if !errors.Is(e, io.EOF) {
				return nil, fmt.Errorf("close returned %v", e)
			}
		case <-time.After(time.Second):
			return nil, fmt.Errorf("close did not unblock Next")
		}
		if e := os.WriteFile(gate+".closed", []byte("closed"), 0600); e != nil {
			return nil, e
		}
		for time.Now().Before(until) {
			records := c.Invocations()
			if len(records) == 1 && records[0].Ref != nil && (op == "close-admitting" || records[0].Cancellation == "acknowledged") {
				out["registry"] = records
				return out, nil
			}
			time.Sleep(time.Millisecond)
		}
		return nil, fmt.Errorf("admission/control did not settle: %v", c.Invocations())
	}
	if op == "invoke" || op == "interaction" || op == "cancel-invocation" || op == "abandon" || op == "drain" {
		stream := c.Invoke(ctx, input, octo.KernelInvokeEnvironmentWire{})
		defer stream.Close()
		out["before"] = len(c.Invocations())
		events := []json.RawMessage{}
		for {
			item, e := stream.Next()
			if e == io.EOF {
				break
			}
			if e != nil {
				out["events"] = events
				out["registry"] = c.Invocations()
				return out, e
			}
			events = append(events, item)
			var value map[string]json.RawMessage
			json.Unmarshal(item, &value)
			if op == "interaction" {
				var kind, eventType, messageKind string
				json.Unmarshal(value["kind"], &kind)
				json.Unmarshal(value["type"], &eventType)
				json.Unmarshal(value["messageKind"], &messageKind)
				if kind == "native" && messageKind == "request" {
					e = c.RespondNativeInteraction(ctx, input.InvocationId.Value, octo.NativeInteractionResponse{RequestId: json.RawMessage(`42`), Payload: map[string]json.RawMessage{"id": json.RawMessage(`42`), "result": json.RawMessage(`"approved"`)}})
				}
				if eventType == "interaction.requested" {
					e = c.RespondInteraction(ctx, input.InvocationId.Value, octo.InteractionResponseWire{InteractionId: "approval", Outcome: "accepted"})
				}
				if e != nil {
					out["events"] = events
					out["registry"] = c.Invocations()
					return out, e
				}
			}
			if len(events) == 1 {
				switch op {
				case "cancel-invocation":
					out["cancel"], e = c.CancelInvocation(ctx, input.InvocationId.Value, "test_cancel")
					if e == nil {
						_, e = c.CancelInvocation(ctx, input.InvocationId.Value, "second")
					}
				case "abandon":
					stream.Close()
					out["events"] = events
					out["registry"] = c.Invocations()
					return out, nil
				case "drain":
					out["drain"] = c.Drain(ctx, time.Now().Add(2*time.Second), "test_drain")
				}
				if e != nil {
					return out, e
				}
			}
		}
		out["events"] = events
		out["registry"] = c.Invocations()
		return out, nil
	}
	ref, e := c.Submit(ctx, input, octo.KernelInvokeEnvironmentWire{})
	if e != nil {
		return nil, e
	}
	out["ref"] = ref
	if op == "cancel" {
		result, e := c.Cancel(ctx, ref, "test_cancel")
		if e != nil {
			return nil, e
		}
		out["cancel"] = result
	}
	stream := c.Subscribe(ctx, ref, 0)
	defer stream.Close()
	frames := []json.RawMessage{}
	for {
		f, e := stream.Next()
		if e == io.EOF {
			break
		}
		if e != nil {
			return nil, e
		}
		frames = append(frames, f)
	}
	out["frames"] = frames
	snapshot, e := c.Get(ctx, octo.KernelLookupKey{RunId: ref.RunId, InvocationId: ref.InvocationId, AgentSessionId: ref.AgentSessionId, SessionGeneration: ref.SessionGeneration, ProtocolMode: ref.ProtocolMode}, ref.KernelInstanceId)
	if e != nil {
		return nil, e
	}
	out["snapshot"] = snapshot
	out["pid"] = os.Getpid()
	return out, nil
}

var _ = fmt.Sprint

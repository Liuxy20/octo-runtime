package octo

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"sync"
	"testing"
	"time"
)

func TestEncodeRejectsNativeInvalidUTF8BeforeJSONReplacement(t *testing.T) {
	value := KernelLookupKey{RunId: string([]byte{0xff}), InvocationId: "i", AgentSessionId: "s", ProtocolMode: "native"}
	_, err := Encode("KernelLookupKey", value)
	var typed *Error
	if !errors.As(err, &typed) || typed.Code != "INVALID_JSON_UNICODE" {
		t.Fatalf("expected strict Unicode rejection, got %v", err)
	}
}

func TestOpaqueNumbersAndPresenceSurviveRoundTrip(t *testing.T) {
	// Preserve large integers and explicit null in extensions without float conversion or omission.
	value, err := Decode[ProviderSession]("ProviderSession", []byte(`{"sessionId":"s","future":{"integer":900719925474099312345,"nullable":null}}`))
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := Encode("ProviderSession", value)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(encoded, []byte(`900719925474099312345`)) || !bytes.Contains(encoded, []byte(`"nullable":null`)) {
		t.Fatalf("opaque JSON changed: %s", encoded)
	}
	if bytes.Contains(encoded, []byte(`"provider"`)) {
		t.Fatalf("absent field was emitted: %s", encoded)
	}
}

func TestRawMalformedUnicodeIsRejected(t *testing.T) {
	for _, payload := range []json.RawMessage{json.RawMessage(`{"x":"\ud800"}`), json.RawMessage{'"', 0xff, '"'}} {
		_, err := Encode("ProviderSession", map[string]any{"sessionId": "s", "future": payload})
		if err == nil {
			t.Fatalf("accepted malformed opaque JSON %q", payload)
		}
	}
}

func TestOpenModelExtensionsRejectMalformedUnicode(t *testing.T) {
	for _, extra := range []map[string]json.RawMessage{
		{string([]byte{0xff}): json.RawMessage(`{"x":1}`)},
		{"future": json.RawMessage(`{"x":"\ud800"}`)},
		{"future": json.RawMessage{'"', 0xff, '"'}},
	} {
		value := ProviderSession{SessionId: "s", Extra: extra}
		for _, encode := range []func() ([]byte, error){
			func() ([]byte, error) { return Encode("ProviderSession", value) },
			func() ([]byte, error) { return json.Marshal(value) },
		} {
			_, err := encode()
			var typed *Error
			if !errors.As(err, &typed) || typed.Code != "INVALID_JSON_UNICODE" {
				t.Fatalf("expected strict extension rejection, got %v", err)
			}
		}
	}
	value := ProviderSession{SessionId: "s", Extra: map[string]json.RawMessage{"\u754c": json.RawMessage(`{"big":900719925474099312345,"n":1.0}`)}}
	encoded, err := Encode("ProviderSession", value)
	if err != nil || !bytes.Contains(encoded, []byte("\u754c")) || !bytes.Contains(encoded, []byte(`{"big":900719925474099312345,"n":1.0}`)) {
		t.Fatalf("valid extension changed: %s, %v", encoded, err)
	}
}

func TestMathematicalIntegerBindingPreservesOpaqueNumbers(t *testing.T) {
	for _, n := range []string{"1", "1.0", "1e0", "9007199254740991.0"} {
		data := []byte(`{"contexts":{"schema":"octo.context-envelope/v3","items":[]},"inputs":[{"type":"text","text":"test"}],"sessionGeneration":` + n + `,"future":{"n":1.0,"big":900719925474099312345}}`)
		value, err := Decode[InvokeInputWire]("InvokeInputWire", data)
		if err != nil {
			t.Fatalf("%s: %v", n, err)
		}
		if !value.SessionGeneration.Set {
			t.Fatal("lost presence")
		}
		encoded, err := Encode("InvokeInputWire", value)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Contains(encoded, []byte(`"n":1.0`)) || !bytes.Contains(encoded, []byte(`900719925474099312345`)) {
			t.Fatalf("opaque numbers changed: %s", encoded)
		}
	}
	for _, n := range []string{"1.5", "true", "null", "9007199254740992"} {
		_, err := Decode[InvokeInputWire]("InvokeInputWire", []byte(`{"contexts":{"schema":"octo.context-envelope/v3","items":[]},"inputs":[{"type":"text","text":"test"}],"sessionGeneration":`+n+`}`))
		if err == nil {
			t.Fatalf("accepted invalid integer %s", n)
		}
	}
}

func TestInvocationInitializationFailureIsStable(t *testing.T) {
	for _, scenario := range []string{"cancelled", "invalid-input", "admission-closed"} {
		t.Run(scenario, func(t *testing.T) {
			client := Attach("unused")
			defer client.Close()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			input, err := Decode[InvokeInputWire]("InvokeInputWire", []byte(`{"contexts":{"schema":"octo.context-envelope/v3","items":[]},"inputs":[{"type":"text","text":"test"}]}`))
			if err != nil {
				t.Fatal(err)
			}
			switch scenario {
			case "cancelled":
				cancel()
			case "invalid-input":
				input.SessionGeneration = Some(int64(-1))
			case "admission-closed":
				client.StopAdmission()
			}
			stream := client.Invoke(ctx, input, KernelInvokeEnvironmentWire{})
			_, first := stream.Next()
			if first == nil {
				t.Fatal("expected initialization failure")
			}
			if scenario == "cancelled" && !errors.Is(first, context.Canceled) {
				t.Fatal(first)
			}
			for n := 0; n < 2; n++ {
				if _, err := stream.Next(); !errors.Is(err, io.EOF) {
					t.Fatalf("Next after error: %v", err)
				}
			}
			if len(client.Invocations()) != 0 {
				t.Fatal("failed initialization retained registry")
			}
			if len(client.transport.sockets) != 0 || client.transport.opening != 0 {
				t.Fatal("preflight failure opened transport")
			}
		})
	}
}

type observedContext struct {
	context.Context
	once    sync.Once
	checked chan struct{}
}

func (c *observedContext) Err() error {
	c.once.Do(func() { close(c.checked) })
	return c.Context.Err()
}

func TestCloseObservationUnblocksPendingCancelAcknowledgement(t *testing.T) {
	for _, callerCancelled := range []bool{false, true} {
		t.Run(map[bool]string{false: "explicit-cancel", true: "caller-cancel"}[callerCancelled], func(t *testing.T) {
			client := Attach("unused")
			defer client.Close()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if callerCancelled {
				cancel()
			}
			observed := &observedContext{Context: ctx, checked: make(chan struct{})}
			stream := client.Invoke(observed, InvokeInputWire{}, KernelInvokeEnvironmentWire{})
			// The terminal frame was delivered, but the separate control request still awaits its ACK.
			r := &record{cancelDone: make(chan struct{})}
			stream.started, stream.record = true, r
			stream.subscription = client.Subscribe(stream.observation, KernelRunRef{}, 0)
			stream.subscription.done = true
			stream.cancelOnce.Do(func() {})
			t.Cleanup(func() { close(stream.cancelFinished); close(r.cancelDone) })
			result := make(chan error, 1)
			go func() { _, err := stream.Next(); result <- err }()
			select {
			case <-observed.checked:
			case <-time.After(time.Second):
				t.Fatal("Next did not reach cancellation wait")
			}
			stream.Close()
			select {
			case err := <-result:
				if !errors.Is(err, io.EOF) {
					t.Fatal(err)
				}
			case <-time.After(time.Second):
				t.Fatal("Close did not unblock Next")
			}
			select {
			case <-r.cancelDone:
				t.Fatal("observation close completed control request")
			default:
			}
		})
	}
}

func TestCancelControlErrorSurvivesNormalExhaustion(t *testing.T) {
	client := Attach("unused")
	defer client.Close()
	stream := client.Invoke(context.Background(), InvokeInputWire{}, KernelInvokeEnvironmentWire{})
	want := &Error{Code: "OPERATION_OUTCOME_UNKNOWN"}
	r := &record{cancelDone: make(chan struct{}), cancelErr: want}
	close(r.cancelDone)
	stream.started, stream.record = true, r
	stream.subscription = client.Subscribe(stream.observation, KernelRunRef{}, 0)
	stream.subscription.done = true
	_, err := stream.Next()
	if !errors.Is(err, want) {
		t.Fatalf("lost control error: %v", err)
	}
}

func TestOversizedLineDoesNotWaitForNewlineOrEOF(t *testing.T) {
	reader, writer := net.Pipe()
	defer reader.Close()
	defer writer.Close()
	c := &channel{Conn: reader, reader: bufio.NewReaderSize(reader, limitReadChunkBytes)}
	done := make(chan error, 1)
	go func() { _, err := c.line(); done <- err }()
	// Keep the peer open; one excess byte must be rejected without waiting for another chunk or EOF.
	if _, err := writer.Write(bytes.Repeat([]byte{'x'}, limitLineBytes+1)); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		var typed *Error
		if !errors.As(err, &typed) || typed.Code != "HOST_FRAME_TOO_LARGE" {
			t.Fatalf("got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("oversized unterminated line blocked")
	}
}

func TestLineBoundaryAndBufferedTail(t *testing.T) {
	for _, size := range []int{limitLineBytes - 1, limitLineBytes, limitLineBytes + 1} {
		data := append(bytes.Repeat([]byte{'x'}, size), []byte("\nnext\r\n")...)
		c := &channel{reader: bufio.NewReaderSize(bytes.NewReader(data), limitReadChunkBytes)}
		line, err := c.line()
		if size > limitLineBytes {
			var typed *Error
			if !errors.As(err, &typed) || typed.Code != "HOST_FRAME_TOO_LARGE" {
				t.Fatalf("size %d: %v", size, err)
			}
			continue
		}
		if err != nil || len(line) != size {
			t.Fatalf("size %d: got %d, %v", size, len(line), err)
		}
		line, err = c.line()
		if err != nil || string(line) != "next\r" {
			t.Fatalf("lost buffered tail: %q, %v", line, err)
		}
	}
}

package octo

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/url"
	"reflect"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"
)

// Client attaches to an existing Kernel; Close releases only this client's observation and control IO.
type Client struct {
	transport       *transport
	mu              sync.Mutex
	stopped         bool
	records         map[string]*record
	controls        chan struct{}
	drainDone       chan struct{}
	drainResult     DrainResult
	controlCtx      context.Context
	controlCancel   context.CancelFunc
	controlDeadline time.Time
}

// Attach uses an existing endpoint; the caller owns Drain/Close, not the Kernel process.
func Attach(endpoint string) *Client {
	ctx, cancel := context.WithCancel(context.Background())
	return &Client{transport: &transport{endpoint: endpoint, sockets: make(map[net.Conn]bool)}, records: make(map[string]*record), controls: make(chan struct{}, limitControlConcurrency), controlCtx: ctx, controlCancel: cancel}
}

// Close releases observers, queued controls and connections; stopping IO does not confirm run cancellation.
func (c *Client) Close() { c.StopAdmission(); c.controlCancel(); c.transport.close() }
func uuid() string {
	var b [16]byte
	if _, e := rand.Read(b[:]); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b[:])
}
func raw(value any) json.RawMessage { b, _ := marshalJSON(value); return b }
func object(value any) map[string]any {
	b := raw(value)
	v, _ := decodeJSON(b)
	m, _ := v.(map[string]any)
	return m
}
func numeric(v any) int64 {
	if n, ok := v.(json.Number); ok {
		x, _ := integerNumber(n)
		return x
	}
	return -1
}
func same(a, b map[string]any, fields []string) bool {
	for _, f := range fields {
		if !jsonEqual(a[f], b[f]) {
			return false
		}
	}
	return true
}
func fullIdentity(actual, expected map[string]any) error {
	if actual["kernel_instance_id"] != expected["kernel_instance_id"] {
		return &Error{Code: "KERNEL_INSTANCE_CHANGED"}
	}
	if !same(actual, expected, receiptFields) {
		return &Error{Code: "RUN_IDENTITY_MISMATCH"}
	}
	return nil
}
func (c *Client) rpc(ctx context.Context, method string, params, result any, beforeWrite func() error) error {
	m, ok := methodRules[method]
	if !ok {
		return &Error{Code: "METHOD_NOT_FOUND"}
	}
	if e := checkStrings(reflect.ValueOf(params), 0); e != nil {
		return e
	}
	pv := object(params)
	if e := validate(m.Params, pv, "$.params"); e != nil {
		return e
	}
	id := uuid()
	line := append(raw(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": pv}), '\n')
	if len(line) > limitRequestBytes {
		return &Error{Code: "INVOKE_REQUEST_TOO_LARGE"}
	}
	timeout := time.Duration(timeoutUnary) * time.Millisecond
	if method == "agent_run.invoke" {
		timeout = time.Duration(timeoutInvokeAck) * time.Millisecond
	}
	call, cancel := deadline(ctx, timeout)
	defer cancel()
	connect, release := deadline(call, time.Duration(timeoutConnect)*time.Millisecond)
	conn, e := c.transport.open(connect)
	release()
	if e != nil {
		return e
	}
	defer conn.Close()
	stop := context.AfterFunc(call, func() { conn.Close() })
	defer stop()
	until, _ := call.Deadline()
	conn.SetDeadline(until)
	if e = call.Err(); e != nil {
		return e
	}
	if beforeWrite != nil {
		if e = beforeWrite(); e != nil {
			return e
		}
	}
	sent := true // Partial writes may be accepted; never replay the side effect.
	if e = conn.write(line); e == nil {
		var b []byte
		b, e = conn.line()
		if e == nil {
			var v any
			v, e = decodeJSON(b)
			if e == nil {
				var answer any
				answer, e = response(v, id)
				if e == nil {
					e = validate(m.Result, answer, "$.result")
					if e != nil {
						e = &Error{Code: "INVALID_RESPONSE", Cause: e}
					}
					if e == nil {
						e = unmarshalWire(raw(answer), result)
					}
				}
			}
		}
	}
	if e != nil && m.SideEffect && method != "agent_run.invoke" && sent {
		if remote, ok := e.(*Error); !ok || !remote.Remote {
			return &Error{Code: "OPERATION_OUTCOME_UNKNOWN", Cause: e}
		}
	}
	return e
}
func response(v any, id string) (any, error) {
	m, ok := v.(map[string]any)
	if !ok || m["id"] != id || m["jsonrpc"] != "2.0" {
		return nil, &Error{Code: "INVALID_RESPONSE"}
	}
	_, hasResult := m["result"]
	_, hasError := m["error"]
	if hasResult == hasError {
		return nil, &Error{Code: "INVALID_RESPONSE"}
	}
	name := "IpcSuccessResponse"
	if hasError {
		name = "IpcErrorResponse"
	}
	if e := validate(definitionRules[name], m, "$"); e != nil {
		return nil, &Error{Code: "INVALID_RESPONSE", Cause: e}
	}
	if hasError {
		err := m["error"].(map[string]any)
		data := err["data"].(map[string]any)
		return nil, &Error{Code: data["code"].(string), Data: data, Remote: true}
	}
	return m["result"], nil
}
func (c *Client) Status(ctx context.Context) (KernelStatus, error) {
	return c.RPCStatus(ctx, IpcEmptyParams{})
}
func (c *Client) List(ctx context.Context) ([]HostedAdapterMetadataWire, error) {
	return c.RPCList(ctx, IpcEmptyParams{})
}
func keyFor(input map[string]any) KernelLookupKey {
	m := map[string]any{}
	for wire, field := range identityInputFields {
		m[wire] = input[field]
	}
	var k KernelLookupKey
	unmarshalWire(raw(m), &k)
	return k
}
func identify(input InvokeInputWire) (InvokeInputWire, error) {
	b, e := Encode("InvokeInputWire", input)
	if e != nil {
		return input, e
	}
	mAny, e := decodeJSON(b)
	if e != nil {
		return input, e
	}
	m := mAny.(map[string]any)
	for _, k := range []string{"runId", "invocationId", "sessionId"} {
		if _, ok := m[k]; !ok {
			m[k] = uuid()
		}
	}
	if _, ok := m["protocol_mode"]; !ok {
		m["protocol_mode"] = "native"
	}
	if _, ok := m["sessionGeneration"]; !ok {
		m["sessionGeneration"] = 0
	}
	return Decode[InvokeInputWire]("InvokeInputWire", raw(m))
}

// Submit leaves accepted execution with the service; ctx prevents writes or requests cancellation by original ref.
func (c *Client) Submit(ctx context.Context, input InvokeInputWire, env KernelInvokeEnvironmentWire) (KernelRunRef, error) {
	return c.submit(ctx, input, env, nil)
}
func (c *Client) submit(ctx context.Context, input InvokeInputWire, env KernelInvokeEnvironmentWire, r *record) (KernelRunRef, error) {
	var zero KernelRunRef
	if e := ctx.Err(); e != nil {
		return zero, e
	}
	request, e := identify(input)
	if e != nil {
		return zero, e
	}
	key := keyFor(object(request))
	status, e := c.Status(ctx)
	if e != nil {
		return zero, e
	}
	if e = ctx.Err(); e != nil {
		return zero, e
	}
	if r != nil {
		c.mu.Lock()
		r.instance = status.KernelInstanceId
		c.mu.Unlock()
	}
	params := IpcInvokeParams{Input: request, ExecutionEnvOverrides: env.ExecutionEnvOverrides, KernelInstanceId: Some(status.KernelInstanceId)}
	sent := false
	var ack IpcInvokeResult
	e = c.rpc(context.Background(), "agent_run.invoke", params, &ack, func() error {
		if e := ctx.Err(); e != nil {
			return e
		}
		c.mu.Lock()
		defer c.mu.Unlock()
		if r != nil && c.stopped {
			return &Error{Code: "CLIENT_INVOCATION_ADMISSION_CLOSED"}
		}
		sent = true
		if r != nil {
			r.submitted = true
		}
		return nil
	})
	if e == nil {
		ref := object(ack.Receipt)
		ref["kernel_instance_id"] = ack.KernelInstanceId
		var result KernelRunRef
		unmarshalWire(raw(ref), &result)
		if ack.KernelInstanceId != status.KernelInstanceId {
			return zero, &Error{Code: "KERNEL_INSTANCE_CHANGED"}
		}
		if !same(ref, object(key), lookupFields) {
			return zero, &Error{Code: "RUN_IDENTITY_MISMATCH"}
		}
		if r == nil && ctx.Err() != nil {
			_, e = c.Cancel(context.Background(), result, "caller_aborted")
		}
		return result, e
	}
	if !sent {
		return zero, e
	}
	if err, ok := e.(*Error); ok && err.Remote {
		return zero, e
	}
	// Write invoke once; lookup recovery starts at first uncertainty and reconnection cannot reset its budget.
	recovery, cancel := deadline(context.Background(), time.Duration(timeoutRecovery)*time.Millisecond)
	defer cancel()
	for _, delay := range repairDelaysMs {
		if wait(recovery, time.Duration(delay)*time.Millisecond) != nil {
			break
		}
		snapshot, queryErr := c.Get(recovery, key, status.KernelInstanceId)
		if queryErr == nil {
			if r == nil && ctx.Err() != nil {
				_, queryErr = c.Cancel(context.Background(), snapshot.Ref, "caller_aborted")
			}
			return snapshot.Ref, queryErr
		}
		if code(queryErr) == "RUN_IDENTITY_MISMATCH" || code(queryErr) == "KERNEL_INSTANCE_CHANGED" {
			return zero, queryErr
		}
	}
	return zero, &Error{Code: "ACCEPTANCE_UNKNOWN", Cause: e}
}
func (c *Client) Get(ctx context.Context, key KernelLookupKey, instance string) (KernelRunSnapshot, error) {
	p := IpcGetParams{Key: key}
	if instance != "" {
		p.KernelInstanceId = Some(instance)
	}
	s, e := c.RPCGet(ctx, p)
	if e != nil {
		return s, e
	}
	m := object(s.Ref)
	if instance != "" && s.Ref.KernelInstanceId != instance {
		return s, &Error{Code: "KERNEL_INSTANCE_CHANGED"}
	}
	if !same(m, object(key), lookupFields) {
		return s, &Error{Code: "RUN_IDENTITY_MISMATCH"}
	}
	if s.Terminal.Set {
		if e = frameIdentity(s.Terminal.Value, s.Ref); e != nil {
			return s, e
		}
		if terminal(s.Terminal.Value) == "" {
			return s, &Error{Code: "HOST_FRAME_INVALID"}
		}
	}
	c.reconcile(s)
	return s, nil
}

// Cancel requires the original full ref; its ACK is not a terminal outcome, and uncertainty forbids replay.
func (c *Client) Cancel(ctx context.Context, ref KernelRunRef, reason string) (IpcCancelResult, error) {
	p := IpcCancelParams{Ref: ref}
	if reason != "" {
		p.Reason = Some(reason)
	}
	return c.RPCCancel(ctx, p)
}
func (c *Client) Respond(ctx context.Context, ref KernelRunRef, response InteractionResponseWire) error {
	_, e := c.RPCRespond(ctx, IpcRespondParams{Ref: ref, Response: response})
	return e
}
func (c *Client) RespondNative(ctx context.Context, ref KernelRunRef, response NativeInteractionResponse) error {
	_, e := c.RPCRespondNative(ctx, IpcRespondNativeParams{Ref: ref, Response: response})
	return e
}
func frameIdentity(frame HostFrame, ref KernelRunRef) error {
	m := object(frame)
	if !same(m, object(ref), receiptFields) {
		return &Error{Code: "RUN_IDENTITY_MISMATCH"}
	}
	return nil
}
func terminal(frame HostFrame) string {
	m := object(frame)
	control, _ := m["control"].(map[string]any)
	if m["kind"] == "control" && control["type"] == "state" {
		for _, s := range terminalStates {
			if control["state"] == s {
				return s
			}
		}
	}
	return ""
}

// Subscription is a single-consumer pull stream without background prefetch; Close only stops observation.
type Subscription struct {
	client      *Client
	ctx         context.Context
	stop        context.CancelFunc
	ref         KernelRunRef
	after       int64
	conn        *channel
	repair      int
	repairUntil time.Time
	done        bool
	mu          sync.Mutex
}

func (c *Client) Subscribe(ctx context.Context, ref KernelRunRef, after int64) *Subscription {
	observe, stop := context.WithCancel(ctx)
	return &Subscription{client: c, ctx: observe, stop: stop, ref: ref, after: after}
}
func (s *Subscription) Close() error {
	s.stop()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.conn != nil {
		return s.conn.Close()
	}
	return nil
}
func (s *Subscription) setConn(conn *channel) { s.mu.Lock(); s.conn = conn; s.mu.Unlock() }
func (s *Subscription) Next() (HostFrame, error) {
	if s.done {
		return nil, io.EOF
	}
	for {
		if e := s.ctx.Err(); e != nil {
			return nil, e
		}
		if s.conn == nil {
			if e := s.connect(); e != nil {
				if e = s.repairAfter(e); e != nil {
					return nil, e
				}
				continue
			}
			if s.done {
				return nil, io.EOF
			}
		}
		b, e := s.conn.line()
		if e != nil {
			if e = s.repairAfter(e); e != nil {
				return nil, e
			}
			continue
		}
		value, e := decodeJSON(b)
		if e != nil {
			return nil, e
		}
		n, ok := value.(map[string]any)
		if !ok {
			return nil, &Error{Code: "INVALID_RESPONSE"}
		}
		if n["method"] == "agent_run.stream_error" {
			if e = validate(definitionRules["IpcStreamErrorNotification"], n, "$"); e != nil {
				return nil, &Error{Code: "INVALID_RESPONSE", Cause: e}
			}
			p := n["params"].(map[string]any)
			if p["kernel_instance_id"] != s.ref.KernelInstanceId {
				return nil, &Error{Code: "KERNEL_INSTANCE_CHANGED"}
			}
			return nil, &Error{Code: p["code"].(string)}
		}
		if e = validate(definitionRules["IpcEventNotification"], n, "$"); e != nil {
			return nil, &Error{Code: "HOST_FRAME_INVALID", Cause: e}
		}
		p := n["params"].(map[string]any)
		if p["kernel_instance_id"] != s.ref.KernelInstanceId {
			return nil, &Error{Code: "KERNEL_INSTANCE_CHANGED"}
		}
		if p["run_id"] != s.ref.RunId || p["stream_id"] != s.ref.StreamId {
			return nil, &Error{Code: "RUN_IDENTITY_MISMATCH"}
		}
		frame := raw(p["event"])
		if e = frameIdentity(frame, s.ref); e != nil {
			return nil, e
		}
		seq := numeric(object(frame)["seq"])
		if seq != s.after+1 || numeric(p["seq"]) != seq {
			return nil, &Error{Code: "STREAM_GAP"}
		}
		s.after = seq
		s.client.observe(s.ref, frame)
		if terminal(frame) != "" {
			s.done = true
			s.Close()
		}
		return frame, nil
	}
}
func (s *Subscription) connect() error {
	timeout := time.Duration(timeoutUnary) * time.Millisecond
	if !s.repairUntil.IsZero() {
		remaining := time.Until(s.repairUntil)
		if remaining <= 0 {
			return &Error{Code: "KERNEL_UNAVAILABLE"}
		}
		if remaining < timeout {
			timeout = remaining
		}
	}
	ctx, cancel := deadline(s.ctx, timeout)
	defer cancel()
	conn, e := s.client.transport.open(ctx)
	if e != nil {
		return e
	}
	s.setConn(conn)
	context.AfterFunc(s.ctx, func() { conn.Close() })
	until, _ := ctx.Deadline()
	conn.SetDeadline(until)
	p := IpcSubscribeParams{Ref: s.ref, AfterSeq: s.after}
	pv := object(p)
	if e = validate(methodRules["agent_run.subscribe"].Params, pv, "$.params"); e != nil {
		return e
	}
	id := uuid()
	line := append(raw(map[string]any{"jsonrpc": "2.0", "id": id, "method": "agent_run.subscribe", "params": pv}), '\n')
	if e = conn.write(line); e != nil {
		return e
	}
	b, e := conn.line()
	if e != nil {
		return e
	}
	v, e := decodeJSON(b)
	if e != nil {
		return e
	}
	answer, e := response(v, id)
	if e != nil {
		return e
	}
	snapshot, e := Decode[KernelRunSnapshot]("KernelRunSnapshot", raw(answer))
	if e != nil {
		return &Error{Code: "INVALID_RESPONSE", Cause: e}
	}
	if e = fullIdentity(object(snapshot.Ref), object(s.ref)); e != nil {
		return e
	}
	if snapshot.Terminal.Set {
		if e = frameIdentity(snapshot.Terminal.Value, s.ref); e != nil {
			return e
		}
		if terminal(snapshot.Terminal.Value) == "" {
			return &Error{Code: "HOST_FRAME_INVALID"}
		}
		s.client.reconcile(snapshot)
		if s.after >= snapshot.LatestSeq {
			s.done = true
			s.Close()
		}
	}
	conn.SetDeadline(time.Time{})
	return nil
}
func (s *Subscription) repairAfter(e error) error {
	if s.conn != nil {
		s.conn.Close()
		s.setConn(nil)
	}
	if s.ctx.Err() != nil {
		return s.ctx.Err()
	}
	if !retryable(e) {
		return e
	}
	if s.repair >= len(repairDelaysMs) {
		return &Error{Code: "KERNEL_UNAVAILABLE", Cause: e}
	}
	if s.repairUntil.IsZero() {
		s.repairUntil = time.Now().Add(time.Duration(timeoutRecovery) * time.Millisecond)
	}
	delay := time.Duration(repairDelaysMs[s.repair]) * time.Millisecond
	s.repair++
	if time.Now().Add(delay).After(s.repairUntil) {
		return &Error{Code: "KERNEL_UNAVAILABLE", Cause: e}
	}
	return wait(s.ctx, delay)
}

// Invoke registers and submits on first Next; its single consumer may race with Close.
// The client owns admission and started cancellation; observer Close cannot retract written requests.
type Invocation struct {
	client          *Client
	ctx             context.Context
	input           InvokeInputWire
	env             KernelInvokeEnvironmentWire
	observation     context.Context
	stopObservation context.CancelFunc
	mu              sync.Mutex
	subscription    *Subscription
	record          *record
	stopWatch       func() bool
	cancelOnce      sync.Once
	cancelFinished  chan struct{}
	done            atomic.Bool
	started         bool
	pending         error
}

func (c *Client) Invoke(ctx context.Context, input InvokeInputWire, env KernelInvokeEnvironmentWire) *Invocation {
	observation, stop := context.WithCancel(context.Background())
	return &Invocation{client: c, ctx: ctx, input: input, env: env, observation: observation, stopObservation: stop, cancelFinished: make(chan struct{})}
}
func (i *Invocation) requestCancel(r *record) {
	i.cancelOnce.Do(func() {
		go func() {
			defer close(i.cancelFinished)
			_, _ = i.client.cancelRecord(context.Background(), r, "caller_aborted")
		}()
	})
}
func (i *Invocation) Close() error {
	i.done.Store(true)
	i.stopObservation()
	i.mu.Lock()
	r, subscription, stopWatch := i.record, i.subscription, i.stopWatch
	i.mu.Unlock()
	if stopWatch != nil {
		stopWatch()
	}
	if r != nil {
		if i.ctx.Err() != nil {
			i.requestCancel(r)
		}
		i.client.interrupted(r, nil)
	}
	if subscription != nil {
		return subscription.Close()
	}
	return nil
}
func (i *Invocation) start() error {
	if e := i.ctx.Err(); e != nil {
		return e
	}
	input, e := identify(i.input)
	if e != nil {
		return e
	}
	i.mu.Lock()
	if i.done.Load() {
		i.mu.Unlock()
		return io.EOF
	}
	r, e := i.client.begin(keyFor(object(input)))
	if e != nil {
		i.mu.Unlock()
		return e
	}
	i.input = input
	i.record = r
	i.stopWatch = context.AfterFunc(i.ctx, func() { i.requestCancel(r) })
	i.mu.Unlock()
	type admission struct {
		ref KernelRunRef
		err error
	}
	ready := make(chan admission, 1)
	// Finish admission recovery after observer exit, retain the original ref and wake pending cancellation.
	go func() {
		ref, e := i.client.submit(i.ctx, input, i.env, r)
		if e != nil {
			i.client.rejected(r, e)
		} else {
			i.client.accepted(r, ref)
		}
		ready <- admission{ref, e}
	}()
	select {
	case <-i.observation.Done():
		return io.EOF
	case result := <-ready:
		if result.err != nil {
			return result.err
		}
		i.mu.Lock()
		defer i.mu.Unlock()
		if i.done.Load() {
			return io.EOF
		}
		i.subscription = i.client.Subscribe(i.observation, result.ref, 0)
		return nil
	}
}
func (i *Invocation) Next() (json.RawMessage, error) {
	if i.done.Load() {
		return nil, io.EOF
	}
	if i.pending != nil {
		e := i.pending
		i.pending = nil
		i.Close()
		return nil, e
	}
	if !i.started {
		i.started = true
		if e := i.start(); e != nil {
			i.Close()
			return nil, e
		}
	}

	for {
		frame, e := i.subscription.Next()
		if i.done.Load() {
			return nil, io.EOF
		}
		if e != nil {
			if errors.Is(e, io.EOF) {
				if i.ctx.Err() != nil {
					i.requestCancel(i.record)
					select {
					case <-i.cancelFinished:
					case <-i.observation.Done():
						return nil, io.EOF
					}
				}
				e = i.client.cancelError(i.observation, i.record)
				if i.done.Load() {
					return nil, io.EOF
				}
				if e == nil {
					e = i.ctx.Err()
				}
				if e == nil {
					e = io.EOF
				}
			}
			i.client.interrupted(i.record, e)
			i.Close()
			return nil, e
		}
		state := terminal(frame)
		m := object(frame)
		if state == "lost" {
			i.pending = &Error{Code: "RUN_OUTCOME_UNKNOWN"}
		}
		if i.input.ProtocolMode.Value == "canonical" {
			if m["kind"] == "canonical" {
				return raw(m["event"]), nil
			}
			ctrl, _ := m["control"].(map[string]any)
			switch ctrl["type"] {
			case "gap":
				e = &Error{Code: "STREAM_GAP"}
			case "error":
				e = &Error{Code: ctrl["code"].(string), Data: ctrl}
				snapshot, queryErr := i.client.Get(context.Background(), i.record.Key, i.subscription.ref.KernelInstanceId)
				if queryErr == nil && snapshot.Terminal.Set && terminal(snapshot.Terminal.Value) == "lost" {
					e = &Error{Code: "RUN_OUTCOME_UNKNOWN"}
				}
			}
			if e != nil {
				i.client.interrupted(i.record, e)
				i.Close()
				return nil, e
			}
			if i.pending != nil {
				e = i.pending
				i.pending = nil
				i.Close()
				return nil, e
			}
			continue
		}
		return frame, nil
	}
}

// Error preserves unknown business codes and data; errors.Is/As can inspect Cause.
type Error struct {
	Code   string
	Data   map[string]any
	Cause  error
	Remote bool
}

func (e *Error) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("%s: %v", e.Code, e.Cause)
	}
	return e.Code
}
func (e *Error) Unwrap() error { return e.Cause }
func code(e error) string {
	if e, ok := e.(*Error); ok {
		return e.Code
	}
	return ""
}
func retryable(e error) bool {
	for _, s := range retryableErrors {
		if code(e) == s {
			return true
		}
	}
	return false
}

// Optional distinguishes absence from explicit zero values; nullable fields use Optional[*T].
type Optional[T any] struct {
	Value T
	Set   bool
}

func Some[T any](v T) Optional[T]                   { return Optional[T]{Value: v, Set: true} }
func (v Optional[T]) IsZero() bool                  { return !v.Set }
func (v Optional[T]) bindingType() reflect.Type     { return reflect.TypeFor[T]() }
func (v Optional[T]) MarshalJSON() ([]byte, error)  { return marshalJSON(v.Value) }
func (v *Optional[T]) UnmarshalJSON(b []byte) error { v.Set = true; return json.Unmarshal(b, &v.Value) }

func marshalOpen(v any, extra map[string]json.RawMessage) ([]byte, error) {
	// Extra is serialized despite json:"-"; validate it before encoding/json replaces invalid Unicode.
	if e := checkStrings(reflect.ValueOf(extra), 0); e != nil {
		return nil, e
	}
	b, e := marshalJSON(v)
	if e != nil {
		return nil, e
	}
	var m map[string]json.RawMessage
	if e = json.Unmarshal(b, &m); e != nil {
		return nil, e
	}
	for k, x := range extra {
		if _, exists := m[k]; exists {
			return nil, fmt.Errorf("extra property conflicts with declared field: %s", k)
		}
		m[k] = x
	}
	return marshalJSON(m)
}
func unmarshalOpen(b []byte, v any, extra *map[string]json.RawMessage) error {
	if e := json.Unmarshal(b, v); e != nil {
		return e
	}
	var m map[string]json.RawMessage
	if e := json.Unmarshal(b, &m); e != nil {
		return e
	}
	t := reflect.TypeOf(v).Elem()
	for i := 0; i < t.NumField(); i++ {
		delete(m, strings.Split(t.Field(i).Tag.Get("json"), ",")[0])
	}
	*extra = m
	return nil
}

// decodeJSON preserves opaque numeric tokens and rejects invalid UTF-8 and surrogates.
func decodeJSON(data []byte) (any, error) {
	if !utf8.Valid(data) || !validEscapes(data) {
		return nil, &Error{Code: "INVALID_JSON_UNICODE"}
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.UseNumber()
	var v any
	if e := d.Decode(&v); e != nil {
		return nil, &Error{Code: "INVALID_JSON", Cause: e}
	}
	var trailing any
	if e := d.Decode(&trailing); e != io.EOF {
		return nil, &Error{Code: "INVALID_JSON"}
	}
	return v, nil
}
func validEscapes(b []byte) bool {
	// Recognize Unicode escapes only inside JSON strings; escaped backslashes are not surrogates.
	in := false
	hex := func(p []byte) int {
		v := 0
		for _, c := range p {
			v *= 16
			switch {
			case c >= '0' && c <= '9':
				v += int(c - '0')
			case c >= 'a' && c <= 'f':
				v += int(c-'a') + 10
			case c >= 'A' && c <= 'F':
				v += int(c-'A') + 10
			default:
				return -1
			}
		}
		return v
	}
	for i := 0; i < len(b); i++ {
		if b[i] == '"' {
			in = !in
			continue
		}
		if !in || b[i] != '\\' {
			continue
		}
		i++
		if i >= len(b) {
			return false
		}
		if b[i] != 'u' {
			continue
		}
		if i+4 >= len(b) {
			return false
		}
		v := hex(b[i+1 : i+5])
		i += 4
		if v >= 0xdc00 && v <= 0xdfff {
			return false
		}
		if v >= 0xd800 && v <= 0xdbff {
			if i+6 >= len(b) || b[i+1] != '\\' || b[i+2] != 'u' {
				return false
			}
			w := hex(b[i+3 : i+7])
			if w < 0xdc00 || w > 0xdfff {
				return false
			}
			i += 6
		}
	}
	return true
}

// Validate and Decode enforce the wire contract; json.Unmarshal alone only binds data.
func Validate(definition string, data []byte) error {
	v, e := decodeJSON(data)
	if e != nil {
		return e
	}
	id, ok := definitionRules[definition]
	if !ok {
		return fmt.Errorf("unknown definition %s", definition)
	}
	return validate(id, v, "$")
}
func Decode[T any](definition string, data []byte) (T, error) {
	var v T
	if e := Validate(definition, data); e != nil {
		return v, e
	}
	e := unmarshalWire(data, &v)
	return v, e
}

// Normalize mathematical integers only in typed integer fields; RawMessage, extensions and json.Number
// retain their original numeric tokens without converting Provider data to floating point.
func unmarshalWire(data []byte, target any) error {
	b, err := integerBindings(data, reflect.TypeOf(target))
	if err != nil {
		return err
	}
	return json.Unmarshal(b, target)
}
func integerBindings(data []byte, t reflect.Type) ([]byte, error) {
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) || t == reflect.TypeFor[json.RawMessage]() {
		return data, nil
	}
	if optional, ok := reflect.Zero(t).Interface().(interface{ bindingType() reflect.Type }); ok {
		return integerBindings(data, optional.bindingType())
	}
	switch t.Kind() {
	case reflect.Int, reflect.Int64, reflect.Int32, reflect.Int16, reflect.Int8:
		var n json.Number
		if err := json.Unmarshal(data, &n); err != nil {
			return nil, err
		}
		i, err := integerNumber(n)
		if err != nil {
			return nil, err
		}
		return []byte(fmt.Sprint(i)), nil
	case reflect.Struct:
		var m map[string]json.RawMessage
		if err := json.Unmarshal(data, &m); err != nil {
			return nil, err
		}
		for i := 0; i < t.NumField(); i++ {
			field := t.Field(i)
			name := strings.Split(field.Tag.Get("json"), ",")[0]
			if !field.IsExported() || name == "-" {
				continue
			}
			if name == "" {
				name = field.Name
			}
			if value, ok := m[name]; ok {
				b, err := integerBindings(value, field.Type)
				if err != nil {
					return nil, err
				}
				m[name] = b
			}
		}
		return marshalJSON(m)
	case reflect.Slice, reflect.Array:
		var a []json.RawMessage
		if err := json.Unmarshal(data, &a); err != nil {
			return nil, err
		}
		for i, value := range a {
			b, err := integerBindings(value, t.Elem())
			if err != nil {
				return nil, err
			}
			a[i] = b
		}
		return marshalJSON(a)
	case reflect.Map:
		var m map[string]json.RawMessage
		if err := json.Unmarshal(data, &m); err != nil {
			return nil, err
		}
		for k, value := range m {
			b, err := integerBindings(value, t.Elem())
			if err != nil {
				return nil, err
			}
			m[k] = b
		}
		return marshalJSON(m)
	}
	return data, nil
}
func integerNumber(n json.Number) (int64, error) {
	r, ok := new(big.Rat).SetString(string(n))
	if !ok || !r.IsInt() || !r.Num().IsInt64() {
		return 0, invalid("integer")
	}
	return r.Num().Int64(), nil
}
func Encode(definition string, value any) ([]byte, error) {
	if e := checkStrings(reflect.ValueOf(value), 0); e != nil {
		return nil, e
	}
	b, e := marshalJSON(value)
	if e != nil {
		return nil, e
	}
	if e = Validate(definition, b); e != nil {
		return nil, e
	}
	return b, nil
}

// Reject invalid UTF-8 before encoding/json can replace it with U+FFFD.
func checkStrings(v reflect.Value, depth int) error {
	if !v.IsValid() {
		return nil
	}
	if depth > 256 {
		return &Error{Code: "INVALID_JSON"}
	}
	if v.Type() == reflect.TypeOf(json.RawMessage{}) {
		if v.IsNil() {
			return nil
		}
		_, e := decodeJSON(v.Bytes())
		return e
	}
	switch v.Kind() {
	case reflect.String:
		if !utf8.ValidString(v.String()) {
			return &Error{Code: "INVALID_JSON_UNICODE"}
		}
	case reflect.Pointer, reflect.Interface:
		if !v.IsNil() {
			return checkStrings(v.Elem(), depth+1)
		}
	case reflect.Struct:
		for i := 0; i < v.NumField(); i++ {
			if v.Type().Field(i).IsExported() && v.Type().Field(i).Tag.Get("json") != "-" {
				if e := checkStrings(v.Field(i), depth+1); e != nil {
					return e
				}
			}
		}
	case reflect.Map:
		for it := v.MapRange(); it.Next(); {
			if e := checkStrings(it.Key(), depth+1); e != nil {
				return e
			}
			if e := checkStrings(it.Value(), depth+1); e != nil {
				return e
			}
		}
	case reflect.Array, reflect.Slice:
		if v.Type().Elem().Kind() != reflect.Uint8 {
			for i := 0; i < v.Len(); i++ {
				if e := checkStrings(v.Index(i), depth+1); e != nil {
					return e
				}
			}
		}
	}
	return nil
}
func marshalJSON(value any) ([]byte, error) {
	var output bytes.Buffer
	encoder := json.NewEncoder(&output)
	encoder.SetEscapeHTML(false)
	if e := encoder.Encode(value); e != nil {
		return nil, e
	}
	return bytes.TrimSuffix(output.Bytes(), []byte{'\n'}), nil
}

type rule struct {
	Ref, Items, If, Then, Else, Not, Contains, PropertyNames, AdditionalProperties           int
	Types, Values, Required                                                                  []string
	Properties                                                                               map[string]int
	Strict, UniqueItems                                                                      bool
	OneOf, AnyOf, AllOf                                                                      []int
	Minimum, Maximum, MinLength, MaxLength, MinItems, MaxItems, MinProperties, MaxProperties *float64
	Pattern, Format                                                                          string
	Extensions                                                                               map[string]int
}
type methodRule struct {
	Params, Result     int
	SideEffect, Stream bool
}

func bound(v float64) *float64 { return &v }
func invalid(path string) error {
	return &Error{Code: "VALIDATION_ERROR", Cause: fmt.Errorf("invalid value at %s", path)}
}
func fits(v float64, min, max *float64) bool {
	return (min == nil || v >= *min) && (max == nil || v <= *max)
}
func jsonEqual(a, b any) bool {
	if x, ok := a.(json.Number); ok {
		y, ok := b.(json.Number)
		if !ok {
			return false
		}
		left, lok := new(big.Rat).SetString(string(x))
		right, rok := new(big.Rat).SetString(string(y))
		return lok && rok && left.Cmp(right) == 0
	}
	if x, ok := a.(map[string]any); ok {
		y, ok := b.(map[string]any)
		if !ok || len(x) != len(y) {
			return false
		}
		for k, v := range x {
			w, exists := y[k]
			if !exists || !jsonEqual(v, w) {
				return false
			}
		}
		return true
	}
	if x, ok := a.([]any); ok {
		y, ok := b.([]any)
		if !ok || len(x) != len(y) {
			return false
		}
		for i, v := range x {
			if !jsonEqual(v, y[i]) {
				return false
			}
		}
		return true
	}
	return reflect.DeepEqual(a, b)
}
func validate(id int, v any, path string) error {
	r := rules[id]
	bad := func() error { return invalid(path) }
	if r.Ref > 0 {
		return validate(r.Ref-1, v, path)
	}
	if len(r.Types) > 0 {
		ok := false
		for _, t := range r.Types {
			switch t {
			case "null":
				ok = ok || v == nil
			case "boolean":
				_, yes := v.(bool)
				ok = ok || yes
			case "string":
				_, yes := v.(string)
				ok = ok || yes
			case "object":
				_, yes := v.(map[string]any)
				ok = ok || yes
			case "array":
				_, yes := v.([]any)
				ok = ok || yes
			case "number", "integer":
				if n, yes := v.(json.Number); yes {
					f, yes := new(big.Rat).SetString(string(n))
					ok = ok || (yes && (t == "number" || f.IsInt()))
				}
			}
		}
		if !ok {
			return bad()
		}
	}
	if len(r.Values) > 0 {
		ok := false
		for _, s := range r.Values {
			w, _ := decodeJSON([]byte(s))
			ok = ok || jsonEqual(v, w)
		}
		if !ok {
			return bad()
		}
	}
	if n, ok := v.(json.Number); ok && (r.Minimum != nil || r.Maximum != nil) {
		f, yes := new(big.Rat).SetString(string(n))
		if !yes {
			return bad()
		}
		if r.Minimum != nil && f.Cmp(new(big.Rat).SetFloat64(*r.Minimum)) < 0 {
			return bad()
		}
		if r.Maximum != nil && f.Cmp(new(big.Rat).SetFloat64(*r.Maximum)) > 0 {
			return bad()
		}
	}
	if s, ok := v.(string); ok {
		if !fits(float64(utf8.RuneCountInString(s)), r.MinLength, r.MaxLength) {
			return bad()
		}
		if r.Pattern != "" {
			pattern := strings.ReplaceAll(r.Pattern, `\u0000`, "\x00")
			matched, e := regexp.MatchString(pattern, s)
			if e != nil || !matched {
				return bad()
			}
		}
		if r.Format == "date-time" { /* Format is an annotation in the source Draft-07 checker. */
		}
	}
	if m, ok := v.(map[string]any); ok {
		if !fits(float64(len(m)), r.MinProperties, r.MaxProperties) {
			return bad()
		}
		for _, k := range r.Required {
			if _, ok := m[k]; !ok {
				return invalid(path + "." + k)
			}
		}
		for k, x := range m {
			if r.PropertyNames > 0 {
				if e := validate(r.PropertyNames-1, k, path); e != nil {
					return e
				}
			}
			if child, yes := r.Properties[k]; yes {
				if e := validate(child, x, path+"."+k); e != nil {
					return e
				}
			} else if r.Strict {
				return invalid(path + "." + k)
			} else if r.AdditionalProperties > 0 {
				if e := validate(r.AdditionalProperties-1, x, path+"."+k); e != nil {
					return e
				}
			}
		}
	}
	if a, ok := v.([]any); ok {
		if !fits(float64(len(a)), r.MinItems, r.MaxItems) {
			return bad()
		}
		contains := r.Contains == 0
		seen := map[string]bool{}
		for i, x := range a {
			if r.Items > 0 {
				if e := validate(r.Items-1, x, fmt.Sprintf("%s[%d]", path, i)); e != nil {
					return e
				}
			}
			if r.Contains > 0 && validate(r.Contains-1, x, path) == nil {
				contains = true
			}
			if r.UniqueItems {
				b, _ := json.Marshal(x)
				if seen[string(b)] {
					return bad()
				}
				seen[string(b)] = true
			}
		}
		if !contains {
			return bad()
		}
	}
	for _, child := range r.AllOf {
		if e := validate(child, v, path); e != nil {
			return e
		}
	}
	for _, union := range []struct {
		ids   []int
		exact bool
	}{{r.OneOf, true}, {r.AnyOf, false}} {
		if len(union.ids) > 0 {
			n := 0
			for _, child := range union.ids {
				if validate(child, v, path) == nil {
					n++
				}
			}
			if n == 0 || (union.exact && n != 1) {
				return bad()
			}
		}
	}
	if r.Not > 0 && validate(r.Not-1, v, path) == nil {
		return bad()
	}
	if r.If > 0 {
		child := r.Else
		if validate(r.If-1, v, path) == nil {
			child = r.Then
		}
		if child > 0 {
			if e := validate(child-1, v, path); e != nil {
				return e
			}
		}
	}
	for ext, limit := range r.Extensions {
		if e := refinement(ext, limit, v, path); e != nil {
			return e
		}
	}
	return nil
}
func refinement(ext string, limit int, v any, path string) error {
	bad := func() error { return invalid(path + " (" + ext + ")") }
	switch ext {
	case "x-octo-unicode-scalar-strings": // decodeJSON has already validated the entire tree.
	case "x-octo-max-json-bytes":
		b, _ := marshalJSON(v)
		if len(b)-separatorEscapeBytes(v) > limit {
			return bad()
		}
	case "x-octo-max-json-depth":
		if depth(v) > limit {
			return bad()
		}
	case "x-octo-max-utf8-bytes":
		if s, ok := v.(string); ok && len(s) > limit {
			return bad()
		}
	case "x-octo-max-utf16-length":
		if s, ok := v.(string); ok {
			n := 0
			for _, c := range s {
				n++
				if c > 0xffff {
					n++
				}
			}
			if n > limit {
				return bad()
			}
		}
	case "x-octo-http-url":
		if s, ok := v.(string); ok {
			u, e := url.Parse(s)
			if e != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" || u.User != nil {
				return bad()
			}
			if port := u.Port(); port != "" {
				if _, e := strconv.ParseUint(port, 10, 16); e != nil {
					return bad()
				}
			}
		}
	case "x-octo-unique-type-keys", "x-octo-unique-env-keys", "x-octo-unique-header-names", "x-octo-unique-resource-refs":
		m, _ := v.(map[string]any)
		if ext == "x-octo-unique-header-names" {
			seen := map[string]bool{}
			for k := range m {
				key := strings.ToLower(k)
				if seen[key] {
					return bad()
				}
				seen[key] = true
			}
			return nil
		}
		field, keys := "items", []string{"namespace", "name"}
		switch ext {
		case "x-octo-unique-env-keys":
			field = "env_variables"
			keys = []string{"key"}
		case "x-octo-unique-header-names":
			field = "headers"
			keys = []string{"name"}
		case "x-octo-unique-resource-refs":
			field = "entries"
			keys = []string{"resource_ref"}
		}
		a, _ := m[field].([]any)
		if direct, ok := v.([]any); ok {
			a = direct
		}
		seen := map[string]bool{}
		for _, x := range a {
			item, _ := x.(map[string]any)
			parts := []any{}
			for _, k := range keys {
				val := item[k]
				if ext == "x-octo-unique-header-names" {
					if s, ok := val.(string); ok {
						val = strings.ToLower(s)
					}
				}
				parts = append(parts, val)
			}
			b, _ := json.Marshal(parts)
			if seen[string(b)] {
				return bad()
			}
			seen[string(b)] = true
		}
	case "x-octo-matching-trigger-fields":
		m, _ := v.(map[string]any)
		fact, _ := m["trigger_fact"].(map[string]any)
		a, ap := m["trigger_seq"]
		b, bp := fact["message_seq"]
		if !jsonEqual(m["trigger_message_id"], fact["message_id"]) || ap != bp || (ap && !jsonEqual(a, b)) {
			return bad()
		}
	case "x-octo-runtime-selection-invariants":
		m, _ := v.(map[string]any)
		a, _ := m["authorized_candidates"].([]any)
		ids, priorities := map[string]bool{}, map[string]bool{}
		for _, item := range a {
			x, _ := item.(map[string]any)
			id, _ := x["runtime_id"].(string)
			p, _ := json.Marshal(x["priority"])
			if ids[id] || priorities[string(p)] {
				return bad()
			}
			ids[id] = true
			priorities[string(p)] = true
		}
		explicit, has := m["explicit_runtime_id"].(string)
		if m["selection_mode"] == "explicit" {
			if !has || len(a) != 1 || !ids[explicit] || m["failover"] != "none" {
				return bad()
			}
		} else if _, exists := m["explicit_runtime_id"]; exists {
			return bad()
		}

	default:
		return fmt.Errorf("unsupported compiled refinement %s", ext)
	}
	return nil
}

// Context limits count compact UTF-8 JSON; Go escapes these scalars even with HTML escaping disabled.
func separatorEscapeBytes(v any) int {
	switch v := v.(type) {
	case string:
		return 3 * (strings.Count(v, "\u2028") + strings.Count(v, "\u2029"))
	case []any:
		n := 0
		for _, item := range v {
			n += separatorEscapeBytes(item)
		}
		return n
	case map[string]any:
		n := 0
		for key, item := range v {
			n += separatorEscapeBytes(key) + separatorEscapeBytes(item)
		}
		return n
	}
	return 0
}
func depth(v any) int {
	n := 0
	switch x := v.(type) {
	case map[string]any:
		if len(x) == 0 {
			return 0
		}
		for _, c := range x {
			if d := depth(c); d > n {
				n = d
			}
		}
		return n + 1
	case []any:
		if len(x) == 0 {
			return 0
		}
		for _, c := range x {
			if d := depth(c); d > n {
				n = d
			}
		}
		return n + 1
	}
	return 0
}

// InvocationRecord stores only identity and cursor metadata; unknown runs keep their capacity slot.
type InvocationRecord struct {
	Key              KernelLookupKey `json:"key"`
	Ref              *KernelRunRef   `json:"ref,omitempty"`
	Phase            string          `json:"phase"`
	Cancellation     string          `json:"cancellation"`
	LastSeq          int64           `json:"lastSeq"`
	ObservationError string          `json:"observationError,omitempty"`
}
type record struct {
	InvocationRecord
	instance      string
	submitted     bool
	observing     bool
	admitted      chan struct{}
	admissionOnce sync.Once
	admissionErr  error
	cancelDone    chan struct{}
	cancelResult  IpcCancelResult
	cancelErr     error
	reason        string
}
type DrainResult struct {
	Complete   bool               `json:"complete"`
	Unresolved []InvocationRecord `json:"unresolved"`
}

func (c *Client) StopAdmission() { c.mu.Lock(); c.stopped = true; c.mu.Unlock() }
func (c *Client) Invocations() []InvocationRecord {
	c.mu.Lock()
	defer c.mu.Unlock()
	result := make([]InvocationRecord, 0, len(c.records))
	for _, r := range c.records {
		v := r.InvocationRecord
		if r.Ref != nil {
			ref := *r.Ref
			v.Ref = &ref
		}
		result = append(result, v)
	}
	return result
}
func (c *Client) begin(key KernelLookupKey) (*record, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.stopped {
		return nil, &Error{Code: "CLIENT_INVOCATION_ADMISSION_CLOSED"}
	}
	if c.records[key.InvocationId] != nil {
		return nil, &Error{Code: "EXECUTION_IDENTITY_CONFLICT"}
	}
	if len(c.records) >= limitInvocations {
		return nil, &Error{Code: "CLIENT_INVOCATION_CAPACITY_EXHAUSTED"}
	}
	r := &record{InvocationRecord: InvocationRecord{Key: key, Phase: "admitting", Cancellation: "none"}, admitted: make(chan struct{}), observing: true}
	c.records[key.InvocationId] = r
	return r, nil
}
func (c *Client) accepted(r *record, ref KernelRunRef) {
	c.mu.Lock()
	r.Ref = &ref
	r.instance = ref.KernelInstanceId
	if r.observing {
		r.Phase = "accepted"
	} else {
		r.Phase = "unobserved"
	}
	r.admissionOnce.Do(func() { close(r.admitted) })
	c.mu.Unlock()
}
func (c *Client) rejected(r *record, e error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	r.admissionErr = e
	r.Phase = "acceptance_unknown"
	r.ObservationError = code(e)
	r.admissionOnce.Do(func() { close(r.admitted) })
	remote, ok := e.(*Error)
	if !r.submitted || (ok && remote.Remote && remote.Code != "RUN_IDENTITY_MISMATCH" && remote.Code != "KERNEL_INSTANCE_CHANGED") {
		delete(c.records, r.Key.InvocationId)
	}
}
func (c *Client) interrupted(r *record, e error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	r.observing = false
	if c.records[r.Key.InvocationId] != r || r.Ref == nil {
		return
	}
	r.Phase = "unobserved"
	if e != nil {
		r.ObservationError = code(e)
	}
}
func (c *Client) observe(ref KernelRunRef, frame HostFrame) {
	c.mu.Lock()
	defer c.mu.Unlock()
	r := c.records[ref.InvocationId]
	if r == nil || r.Ref == nil || *r.Ref != ref {
		return
	}
	seq := numeric(object(frame)["seq"])
	if seq > r.LastSeq {
		r.LastSeq = seq
	}
	state := terminal(frame)
	if state == "lost" {
		r.Phase = "unobserved"
		r.ObservationError = "RUN_OUTCOME_UNKNOWN"
	} else if state != "" {
		delete(c.records, ref.InvocationId)
	}
}
func (c *Client) reconcile(s KernelRunSnapshot) {
	c.mu.Lock()
	r := c.records[s.Ref.InvocationId]
	if r == nil || (r.instance != "" && r.instance != s.Ref.KernelInstanceId) || !same(object(r.Key), object(s.Ref), lookupFields) {
		c.mu.Unlock()
		return
	}
	if r.Ref != nil && *r.Ref != s.Ref {
		c.mu.Unlock()
		return
	}
	r.Ref = &s.Ref
	r.instance = s.Ref.KernelInstanceId
	r.admissionOnce.Do(func() { close(r.admitted) })
	c.mu.Unlock()
	if s.Terminal.Set {
		c.observe(s.Ref, s.Terminal.Value)
	}
}
func (c *Client) CancelInvocation(ctx context.Context, id, reason string) (IpcCancelResult, error) {
	c.mu.Lock()
	r := c.records[id]
	c.mu.Unlock()
	if r == nil {
		return IpcCancelResult{}, &Error{Code: "INVOCATION_NOT_TRACKED"}
	}
	return c.cancelRecord(ctx, r, reason)
}

// Start one control per record; both its original deadline and first drain bound admission waits and IO.
// Do not send after expiry even if a slot opens; an unconfirmed ACK keeps the run unknown and registered.
func (c *Client) cancelRecord(ctx context.Context, r *record, reason string) (IpcCancelResult, error) {
	ctx, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(c.controlCtx, cancel)
	defer stop()
	defer cancel()
	c.mu.Lock()
	if r.reason == "" {
		r.reason = reason
	}
	if r.Cancellation == "none" {
		r.Cancellation = "requested"
	}
	c.mu.Unlock()
	select {
	case <-ctx.Done():
		return IpcCancelResult{}, ctx.Err()
	case <-r.admitted:
	}
	c.mu.Lock()
	if r.Ref == nil {
		e := r.admissionErr
		c.mu.Unlock()
		return IpcCancelResult{}, e
	}
	if r.ObservationError == "RUN_OUTCOME_UNKNOWN" {
		c.mu.Unlock()
		return IpcCancelResult{}, &Error{Code: "RUN_OUTCOME_UNKNOWN"}
	}
	if c.records[r.Key.InvocationId] != r {
		c.mu.Unlock()
		return IpcCancelResult{}, nil
	}
	if r.cancelDone != nil {
		done := r.cancelDone
		c.mu.Unlock()
		select {
		case <-ctx.Done():
			return IpcCancelResult{}, ctx.Err()
		case <-done:
		}
		c.mu.Lock()
		defer c.mu.Unlock()
		return r.cancelResult, r.cancelErr
	}
	r.cancelDone = make(chan struct{})
	ref := *r.Ref
	reason = r.reason
	c.mu.Unlock()
	var result IpcCancelResult
	var e error
	select {
	case c.controls <- struct{}{}:
		// First drain also bounds queued controls; recheck after admission because cancellation and a slot can race.
		c.mu.Lock()
		until := c.controlDeadline
		c.mu.Unlock()
		if c.controlCtx.Err() != nil || (!until.IsZero() && !time.Now().Before(until)) {
			e = &Error{Code: "DRAIN_DEADLINE_EXCEEDED"}
		} else {
			if !until.IsZero() {
				var release context.CancelFunc
				ctx, release = context.WithDeadline(ctx, until)
				defer release()
			}
			result, e = c.Cancel(ctx, ref, reason)
		}
		<-c.controls
	case <-ctx.Done():
		e = ctx.Err()
	}
	c.mu.Lock()
	r.cancelResult = result
	r.cancelErr = e
	if e == nil {
		r.Cancellation = "acknowledged"
	} else {
		r.Cancellation = "unknown"
	}
	close(r.cancelDone)
	c.mu.Unlock()
	return result, e
}
func (c *Client) cancelError(observation context.Context, r *record) error {
	c.mu.Lock()
	done := r.cancelDone
	c.mu.Unlock()
	if done != nil {
		// Observer closure stops waiting; the control task retains cancellation ownership and its outcome.
		select {
		case <-done:
		case <-observation.Done():
			return observation.Err()
		}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return r.cancelErr
}
func (c *Client) RespondInteraction(ctx context.Context, id string, response InteractionResponseWire) error {
	ref, e := c.trackedRef(id)
	if e != nil {
		return e
	}
	return c.Respond(ctx, ref, response)
}
func (c *Client) RespondNativeInteraction(ctx context.Context, id string, response NativeInteractionResponse) error {
	ref, e := c.trackedRef(id)
	if e != nil {
		return e
	}
	return c.RespondNative(ctx, ref, response)
}
func (c *Client) trackedRef(id string) (KernelRunRef, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	r := c.records[id]
	if r == nil {
		return KernelRunRef{}, &Error{Code: "INVOCATION_NOT_TRACKED"}
	}
	if r.Ref == nil {
		return KernelRunRef{}, &Error{Code: "INVOCATION_NOT_ACCEPTED"}
	}
	return *r.Ref, nil
}

// Drain uses the earlier absolute deadline from until or ctx, bounds queued controls and shares its first result.
// Do not add subscriptions; release only confirmed terminal records, leaving Unresolved to the owner.
func (c *Client) Drain(ctx context.Context, until time.Time, reason string) DrainResult {
	c.mu.Lock()
	if c.drainDone != nil {
		done := c.drainDone
		c.mu.Unlock()
		<-done
		c.mu.Lock()
		defer c.mu.Unlock()
		return c.drainResult
	}
	c.stopped = true
	c.drainDone = make(chan struct{})
	c.controlDeadline = until
	c.mu.Unlock()
	budget, cancel := context.WithDeadline(ctx, until)
	defer cancel()
	stop := context.AfterFunc(budget, c.controlCancel)
	defer stop()
	defer c.controlCancel()
	for budget.Err() == nil {
		records := c.Invocations()
		if len(records) == 0 {
			break
		}
		jobs := make(chan InvocationRecord)
		var wg sync.WaitGroup
		for n := 0; n < limitLookupConcurrency; n++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for item := range jobs {
					if budget.Err() != nil {
						return
					}
					c.mu.Lock()
					r := c.records[item.Key.InvocationId]
					instance := ""
					if r != nil {
						instance = r.instance
					}
					c.mu.Unlock()
					if r == nil || instance == "" {
						continue
					}
					snapshot, e := c.Get(budget, item.Key, instance)
					if e == nil && (!snapshot.Terminal.Set || terminal(snapshot.Terminal.Value) == "") {
						_, _ = c.cancelRecord(budget, r, reason)
					}
				}
			}()
		}
		for _, r := range records {
			select {
			case jobs <- r:
			case <-budget.Done():
			}
		}
		close(jobs)
		wg.Wait()
		if wait(budget, 100*time.Millisecond) != nil {
			break
		}
	}
	result := DrainResult{Unresolved: c.Invocations()}
	result.Complete = len(result.Unresolved) == 0
	c.mu.Lock()
	c.drainResult = result
	close(c.drainDone)
	c.mu.Unlock()
	return result
}

var _ json.RawMessage

// Transport owns platform selection and bounded byte IO; the client owns methods, identity and recovery.
type transport struct {
	endpoint string
	mu       sync.Mutex
	closed   bool
	sockets  map[net.Conn]bool
	opening  int
}
type channel struct {
	net.Conn
	reader  io.Reader
	owner   *transport
	once    sync.Once
	pending []byte
	chunk   []byte
}

// Select the platform internally; callers provide only an endpoint and never select transport files.
var dialWindows func(context.Context, string) (net.Conn, error)

func dial(ctx context.Context, endpoint string) (net.Conn, error) {
	if runtime.GOOS == "windows" {
		return dialWindows(ctx, endpoint)
	}
	var d net.Dialer
	return d.DialContext(ctx, "unix", endpoint)
}

func (t *transport) open(ctx context.Context) (*channel, error) {
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		return nil, &Error{Code: "CLIENT_CLOSED"}
	}
	if len(t.sockets)+t.opening >= limitConnections {
		t.mu.Unlock()
		return nil, &Error{Code: "CLIENT_CAPACITY_EXHAUSTED"}
	}
	t.opening++
	t.mu.Unlock()
	conn, e := dial(ctx, t.endpoint)
	t.mu.Lock()
	defer t.mu.Unlock()
	t.opening--
	if e != nil {
		return nil, &Error{Code: "KERNEL_UNAVAILABLE", Cause: e}
	}
	if t.closed {
		conn.Close()
		return nil, &Error{Code: "CLIENT_CLOSED"}
	}
	t.sockets[conn] = true
	return &channel{Conn: conn, reader: conn, owner: t}, nil
}
func (t *transport) close() {
	t.mu.Lock()
	t.closed = true
	for conn := range t.sockets {
		conn.Close()
	}
	t.mu.Unlock()
}
func (c *channel) Close() error {
	var e error
	c.once.Do(func() { e = c.Conn.Close(); c.owner.mu.Lock(); delete(c.owner.sockets, c.Conn); c.owner.mu.Unlock() })
	return e
}

// Bound actual bytes before parsing; exclude LF, retain CR and preserve the next line for the next call.
func (c *channel) line() ([]byte, error) {
	var out []byte
	if c.chunk == nil {
		c.chunk = make([]byte, limitReadChunkBytes)
	}
	part := c.pending
	c.pending = nil
	var e error
	for {
		end := bytes.IndexByte(part, '\n')
		size := len(part)
		if end >= 0 {
			size = end
		}
		if len(out)+size > limitLineBytes {
			return nil, &Error{Code: "HOST_FRAME_TOO_LARGE"}
		}
		out = append(out, part[:size]...)
		if end >= 0 {
			c.pending = part[end+1:]
			return out, nil
		}
		if e != nil {
			if ne, ok := e.(net.Error); ok && ne.Timeout() {
				return nil, &Error{Code: "KERNEL_TIMEOUT", Cause: e}
			}
			return nil, &Error{Code: "CONNECTION_CLOSED", Cause: e}
		}
		// Read exposes received bytes immediately; ReadSlice could wait on a short oversized tail without LF.
		var n int
		n, e = c.reader.Read(c.chunk)
		part = c.chunk[:n]
	}
}
func (c *channel) write(b []byte) error {
	for len(b) > 0 {
		n, e := c.Write(b)
		b = b[n:]
		if e != nil {
			return &Error{Code: "CONNECTION_CLOSED", Cause: e}
		}
		if n == 0 {
			return &Error{Code: "CONNECTION_CLOSED", Cause: io.ErrShortWrite}
		}
	}
	return nil
}
func deadline(ctx context.Context, d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, d)
}
func wait(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
func cancelled(e error) bool {
	return errors.Is(e, context.Canceled) || errors.Is(e, context.DeadlineExceeded)
}

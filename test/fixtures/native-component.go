package main

import (
  "bufio"
  "encoding/json"
  "flag"
  "fmt"
  "os"
)

func main() {
  config := flag.String("config", "", "")
  endpoint := flag.String("endpoint", "", "")
  label := flag.String("label", "", "")
  flag.Parse()
  cwd, _ := os.Getwd()
  snapshot, _ := json.Marshal(map[string]any{"config": *config, "endpoint": *endpoint, "label": *label, "cwd": cwd, "pid": os.Getpid()})
  if err := os.WriteFile(*config+".observed", snapshot, 0600); err != nil { panic(err) }
  scanner := bufio.NewScanner(os.Stdin)
  for scanner.Scan() {
    var request struct { Type string `json:"type"`; ID string `json:"request_id"` }
    if json.Unmarshal(scanner.Bytes(), &request) == nil && request.Type == "component.stop" {
      reply, _ := json.Marshal(map[string]any{"type": "component.stopped", "request_id": request.ID, "complete": *label != "incomplete"})
      fmt.Println(string(reply))
      return
    }
  }
}

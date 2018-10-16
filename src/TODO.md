## Implementation Issues

### const unique

A way to make data ummutable. Check reference counting.

## Language Changes

### Cast from const ^[]byte to string

This should be a O(1) implementation

### Global Variables

Global variables are always let and always implicitly const.
This way they are multi-threading safe.

### Spawn and Async

Impelement coroutines with callbacks instead of multiple stacks.

## Language Extensions

### Components

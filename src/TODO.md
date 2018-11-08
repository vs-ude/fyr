## Implementation Issues

### const unique

A way to make data ummutable. Check reference counting.

## Language Changes

## Templates

Template types without parameters must not be used as types.

~~Pointers with different modes must be comparable.~~

Declare all members of a template instantiation before checking the body.
Currently the functions must appear in a certain order to make it compile.

### Global Variables

Global variables are always let and always implicitly const.
This way they are multi-threading safe.

### Spawn and Async

Impelement coroutines with callbacks instead of multiple stacks.

## Language Extensions

### Components

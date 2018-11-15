## Implementation Issues

### const unique

A way to make data ummutable. Check reference counting.

~~Pointers with different modes must be comparable.~~

Declare all members of a template instantiation before checking the body.
Currently the functions must appear in a certain order to make it compile.

Template types without parameters must not be used as types.
Or make this a shortcut.

For loops on slices containing pointers free the element that we iterate over.

## Language Changes

### Global Variables

Global variables are always let and always implicitly const.
This way they are multi-threading safe.

### Spawn and Async

Impelement coroutines with callbacks instead of multiple stacks.

## Language Extensions

### Components

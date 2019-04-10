## Implementation Issues

### const unique

A way to make data ummutable. Check reference counting.
Will require atomic reference counting/locking, even on const types.

~~Pointers with different modes must be comparable.~~

Declare all members of a template instantiation before checking the body.
Currently the functions must appear in a certain order to make it compile.

Template types without parameters must not be used as types.
Or make this a shortcut.

~~For loops on slices containing pointers free the element that we iterate over.~~

Put a struct on the stack with `let`. Then call a non-const function.
This changes the value assigned to via `let` and must not be allowed.

## Language Changes

`for` loop over a string should iterate the bytes, not the runes.
Put rune decoding into the utf8 library.

Strings should be immutable arrays.
Should they still contain a trailing zero? Would at least affect the println implementation.

### Global Variables

One idea:
Global variables are always let and always implicitly const.
This way they are multi-threading safe.

Another idea:
Global variables are duplicated in each component that allows for threads.
Implementation idea: global variables become members of a package component.
Each threaded component implicitly includes the package components "it needs".
Which one does it need?

### Spawn and Async

No unlocking/decrefing when spawning. Generate a wrapper function that unlocks/decrefs the parameters.

## Language Extensions

### Components

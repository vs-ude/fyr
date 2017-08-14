# Fyr

## Installation

To install all dependencies after cloning the git respository, go to the `fyr` directory and execute:

```
npm install
```

To build the software (output is written to `/lib`), execute:

```
npm run build
```

Running `npm build:parser` will only generate fresh JavaScript from the `parser.pegjs` parser definition.

## Running the compiler

```
node ./lib/index.js compile examples/mem.wl examples/example3.wl
```

The file `mem.wl` must always be part of the compilation, since this is currently the fyr runtime.

## Todos

- Interfaces
    - Type checking
    - Code generation (including automated boxing and unboxing)
- Type switch statement
- Parsing of generic structs
- Generics with interfaces
- Generics without interfaces
- @ constructor
- Automatically include the runtime souces
- struct implements
    - checking
- map
    - codegen

# Wish List
- Package structure
- Documentation generator
- A new parser that handles comments and spaces in a sane way
- Generic interfaces?

## Pending Fixes

### Pruning if-clauses

If an if-clause is pruned, decrease the reference count of all variables used therein.
```
    var x = ("Hallo", (42, true))
    var x1 string
    var x2 int
    var x3 bool
    x1, (x2, x3) = x
    if (false) {
        return x1, <int16>x2, x3
    }
```
Here the x-es should not be assigned at all if they are used in the if-clause only.

### Check for the assignment of non trivial interfaces

### Avoid types any and null in vars, structs, etc.


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
node ./lib/index.js compile examples/example3.wl
```
## Todos

- Interfaces
-- Type checking
-- Code generation
- Type switch statement
- Generics with interfaces
- Generics without interfaces
- AndType should be mapped to interfaces
- Change prededence of OrType and AndType
- @constructor

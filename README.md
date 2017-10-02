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

## Setup

Install the `wabt` tools and make sure that `wast2wasm` is in your `PATH`.
Now set the path to the fyr directory like this:

```
export FYRPATH=/your/path/to/fyr
```

## Running the compiler

```
fyrc examples/mandelbrot.fyr
```

The output of the above command is `mandelbrot.wasm` in the same directory.

## Running the generated code

Some examples come with an HTML page.
Make it available with `python -m SimpleHTTPServer 8000` and open the HTML page.
It will load the WASM code and execute it.

Other examples are made to run in NodeJS.
Use the `runwasm.js` tool to execute WASM in NodeJS as follows:

```
runwasm mandelbrot.wasm
```

For benchmarking execute 

```
time runwasm mandelbrot.wasm main
```

The performance overhead of launching node is around 100ms on a modern machine.
Hence, benchmarks must run significantly longer to produce meaningful results.

## Todos

- Type switch statement
- Normal switch statement
- Automatically include the runtime souces
- map
    - tuple assignment
    - iteration
- Coroutines
- Builtin integer math functions
- Blocks in area-allocation-mode are not added to the block-free-list if all areas could be cleaned
- Iterate over null slice
- Array literals such as [...]byte[1,2,3,4]
- Array literals assigned to const variables are stored in the text segment if they contain primitives only
- Bit-literals such as 0b11001
- Not all types are properly wrapped in interfaces upon assignment
- Type casts can remove const or scope, which is not ok

# Wish List
- Generics
- Components
- Models
- Services
- Package structure
- Documentation generator
- A new parser that handles comments and spaces in a sane way
- Iteration over custom types
- Custom types as keys in a map
- Use f.copysign for < 0

## Compiler optimizations

- Copying structs with multiple i64.load/i64.store has sub-optimal stack handling
- Invert comparison in condition expression, e.g. i32.ge instead of i32.lt followed by i32.eqz
    - However, measurements show no significant improvement here
- Use less locals to improve register allocation
- Assigning to a non-initialized variable. Do not zero it. Part for dead code removal

### Optimization hints extracted from measurements

- Zero checks are expensive. if, br_if, divide by zero ... little difference
    - Try to avoid these checks where possible
- Global variables for SP are a bad idea, since it is significantly slower
- Passing variables via the heap stack is even much slower
- Calling functions is expensive
    - Try to inline where possible
- Startup time in node is 80ms

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

### Avoid types any and null in vars, structs, etc.

### Codegen for named return types

# Language Specification

## Primitive Types

All numeric types (`int`, `uint`, ...) and `bool` are primitives.
Furthermore, `null` and `void` are primitives as well.
Primitive types are immutable, however, they can be assignable.
Hence, during an assignment all bytes of a primitive are overwritten, but it is not possible to mutate single bytes of a primitive without assigning to it.
An exception if of course the use of unsafe pointers which can change all memory.
However, mutating a primitive this way is considered to result in undefined behavior.

## Value Types

Structs, arrays, tuples and primitive types are value types.
Value types are copied when being assigned.
Some value types are mutable (such as structs), but they are not necessarily mutable (such as `int` which is a primitive).

Boxed types such as `interface{int}` and the empty `interface{}` are value types, too, because they store copies of data instead of pointing to them.
A boxed pointer like `interface{*int}` is in this respect similar to a struct with only one field pointing to an int.
The following examples shows such a struct that is a value type, but it contains a pointer type.

```
// Value types which contain a pointer.
struct {
    value *int
}
interface {*int}
```

### Pure Value Types

A value type that does not contain any pointer types is a pure value.
Therefore, an assignment of a pure value results necessarily in a deep copy of this value.

## Pointer Types

There are six kinds of pointers.
- Safe pointers as in `*Widget`.
- Unsafe pointers as in `#int`
- Slices as in `[]int`. A slice is a pointer to the underlying array.
- Interfaces are pointers as well as long as the interface contains at least one function. However, boxed types like `interface{int}` or the empty `interface{}` are not pointers.
- A `map` is a pointer to the map`s internal data structures
- A `string` is a pointer to a sequence of bytes with a well known length

All pointer-like types are immutable, but the type they are pointing to is not necessarily immutable.

### Interface Pointers

Am interface with at least one function is a pointer to a struct that implements the interface as in the following example.

```
type S struct {
}

func S.print() {
}

type I interface {
    func print()
}

var ptr *S = &{}
var iface I = ptr
```

### Pointer Coercion

It is possible to assign `null` to all pointer types.
Without any initialization, the value of all pointer types is equal to `null`.

A normal pointer can be assigned to an interface if the pointer is pointing to a struct type and this struct type implements the interface.

Conversion between normal pointers and unsafe pointers requires a type cast.

## Reference Types

References are a restricted kind of pointers which can optionally point to an address on the stack.
The compile guarantees that the lifetime of a reference is never longer than the lifetime of the stack-variable it is pointing to.
To guarantee this restriction, reference types are only allowed on function parameters and local variables.
Consequently, the return type of a function cannot be a reference type.

Reference types cannot be used to compose more complex types.
Hence, references cannot appear in structs, tuples or arrays.
Furthermore, there are no pointers to reference types and no references pointing to references etc. For example, `[]&int` is not allowed, whereas `&[]int` is ok.

Pointer-like types can be turned into a reference type by prepending `&` as in `&[]int`. In this example, the type is a slice which points to an underlying array of integers. This array can be located on the stack or the heap.

A non-reference pointer can be assinged to a reference pointer if both point to the same type.
The other way round is not allowed, because this could mean that the lifetime of the pointer is longer than the lifetime of the stack-variable it is pointing to.

References are not allowed on strings, maps and unsafe pointers.
The bytes of a string can never exist on the stack.
Hence, string references are pointless.
Unsafe pointers can point anywhere.
Hence, they can point to stack values without becoming a reference.
Consequently, there are no unsafe references.
The content of a `map` can never exist on the stack.
Consequently, a reference to a map is pointless.

A reference interface means that the interface value might point to a value that itself is located on the stack.
A reference pointer can point to a value that can be located on the stack.
A reference slice points to an array that can be located on the stack.

The notation of a reference pointer is `&*Point`. Reference pointers are used frequently in Fyr, but this syntax is awkward. Therefore, a shortcut is allowed. `&Point` is the same `&*Point`. A reference to a non-pointer-like type is automatically extended to a reference pointer that is pointing to this type. It is idiomatic Fyr to write `&Point` instead of `&*Point`.

### Reference Coercion

A pointer type is automatically coerced to its equivalent reference type where required.

A value type ... TODO

## Const Types

A type marked as const becomes immutable.
That means, the bytes storing the instance of the type cannot be altered (except for an assignment).
Furthermore, it is impossible to derive a non-const-value from a const-value.
The only exception are types which cannot be marked as const.

Primitive types cannot be marked as const, since they are immutable by definition.
The same applies to strings, since they are immutable by definition as well.

For const structs, arrays, slices, tuples and maps, being const means that the elements are neither immutable nor assignable, because assigning to an element means mutating the struct/array/slice/tuple/map.

### Const Pointers and Const Boxes

Pointer-like types are immutable by definition, too, because the bytes holding the pointer are either replaced alltogether (during an assignment) or not at all. Nevertheless, `const` can be applied to pointer types. The `const` restriction extends to the type the pointer is pointing to. Hence, the following two types are considered to be equal and can be assigned to each other:

```
var a const *Widget
var b *const Widget
a = b
b = a

var x const []*Widget
var y []const *Widget
x = y
y = x
```

The same applies to boxed types as in the following example, where `ptr` is a boxed pointer that points to an instance of `T`.
Since the box is const, the contained pointer is const and consequently, the value stored in the box is const, too.

```
var ptr const interface{*T}
```

The compiler will always normalize types by pulling the `const` in front of the pointer and in front of any boxing.
Hence, `*const Widget` is not idiomatic Fyr.
Use `const *Widget` instead.
Furthermore, `const` is pulled out of a box. i.e. the type `interface{const *T}` is normalized to `const interface{*T}`.

However, a slice/array/map of const elements is not normalized to a const slice of non-const elements.
In the case of  `[]const T` the slice elements can still be assigned to.
In comparison, in the case of `const []T` all elements are consts and the elements of the slice cannot be assigned to.

Dereferencing a const-pointer results in a const value, i.e. in the follwing example the type of `v` is `const S`.

```
type S struct {
}

var ptr const *S = ...
var v = *ptr
```

### Const Coercion

The type `T` is always assignable to `const T`.

However, assigning `const T` to `T` is not always possible since it could allow to retrieve a non-const value from a const type.
This assignment is only allowed if `T` is a value-type that either does not contain any pointer or all contained pointers are const.

The const boxed type `const interface{T}` and the empty interface `const interface{}` cannot be assigned to their non-const counterparts, because at compile time it is unknown what is contained by the empty interface.
The same applies to generics which must provide one code for all types, some of which are const-assignable, other not.
Consequently, it is not allowed for all boxed types. 

### Const and Comparison

Const types and their non-const counterparts are comparable using `==`, `!=`, `<` etc. if the non-const type is comparable.

### Const and Assignment

A variable storing a const type can still be assignable as in the following example:

```
var w const *Widget = null
w = createButton()
```

Hence, const means that a type becomes immutable, but the variable holding the type instance can still be assignable. To make a variable non-assignable, replace `var` with `const` as in the following example:

```
const w *Widget = createButton()
// The following line results in an error since w is not assignable
w = thisWontWork() 
```

Both concepts can be combined as in the following example

```
const w const *Widget = createButton()
```

Here `w` holds a pointer to an immutable `Widget` and the variable `w` is non-assignable. Note that there might still exist another non-const pointer to the same `Widget`. Hence, the widget might still mutate, but using a const-pointer the `Widget` cannot be mutated.

## The Empty Interface Type

The type `interface{}` is the empty interface and is considered to be a value type. All types can be assigned to it, except for reference types.

It is explicitly allowed to store const types in an empty interface.

## Box Types

Boxing is required by Fyr's implementation of generics.
Outside generics, there is no need to work with boxed types.
A generic function has only one code that works for all types, which reduces code size.
Therefore, generic functions treat all generic types as boxed types.

A type `T` is boxed by the type `interface{T}`. The boxed type can be used anywhere where the unboxed type can be used.
Thus, boxed types are automatically coerced to their boxed type.
The only exception is that the address operator `&`. When applied to a boxed type, `&` returns a pointer to an interface `*interface{T}`, whereas `&` applied to `T` yields a pointer to `T`, i.e. `*T`.

```
var a interface{int} = 42
// a is automatically coerced to int
var x int = a * 2
```

The type `T` is automatically coerced to the type `interface{T}` where required.

```
var i int = 42
// i is automatically coered to interface{int}
var a interface{int} = i
```

## Map Type

They key and value types of a map must not be references.
The key is either a primitive type, a string, an unsafe pointer type, or a safe pointer type.

## Immutability

If a type is immutable, then it is not allowed to mutate the bytes storing an instance of this type.

```
type S struct {
    x int
}
var m *S = &{x: 42}
var i const *S = m
``` 

In the above example, `i` points to an immutable instance of `S`. Consequently it is not allowed to write `i.x = 0`, because that would mutate the struct `i` is pointing to.

A value can be mutated by either accessing one of its fields with the `.` operator, or by using the `[]` operator.

It is allowed to hold const-pointers and non-const pointers to the same value. Hence, a programmer must be aware that a value can still be mutated (via one of the non-const pointers), even so the programmer sees a const-pointer to the value.

## Assignability

A variable is assignable, if a value can be assigned to it using `=` as in `i = m`.
In the case of integers and unsafe pointers, the operators `++` and `--` are treated as assignment, too.
Even if the type stored in the variable is immutable, it might still be possible to assign it. In the above example, it is valid to write `i = m` which is an assignment, but it is not valid to write `i.x = 1`, because that is a mutation.

By default, all variables are assignable. Furthermore, fields of a struct and elements of an array or tuple are assignable. However, if the value itself is const, then fields or elements are not assignable. A variable is non-assignable if it is defined using `const` instead of `var` as in

```
const i = 42
// The following line yields an error
i = 43
```

import . {
    func logString(string)
    func logNumber(uint)
} from "imports"

import "fyr/system"

type Point struct {
    x int
    y int
    next *Point
}

var p *Point

func main() *Point {
    logString("Hello from main")
    var tmp = &Point{x:20, y: 22}
    logNumber(<uint><#Point>tmp)
    p = &{x: 10, y: 11, next: tmp}
    logNumber(<uint><#Point>p)
    tmp = &{x:20, y: 22}
    logNumber(<uint><#Point>tmp)
    useless(tmp)
    return &{x: 42, y:84, next: tmp}
}

func useless(p *Point) {
    var arr [256]byte
    // Enforce a garbage collection
    system.garbageCollect()
}

func lens() {
    logNumber(<uint>"Hallo".len())
    var arr [256]byte
    logNumber(<uint>arr.len())
    var slice = []int[5,6,7,8,9]
    logNumber(<uint>slice.len())
    logNumber(<uint>slice.cap())

    var a1 = []uint[1,2,3]
    var a2 = []uint[7,8,9,10]
    var a3 = a1.append(...a2)
    logNumber(<uint>a3.len())
    logNumber(<uint>a3.cap())
    logNumber(a3[0])
    logNumber(a3[3])
    logString("append 2")
    var a4 = a3.append(101, 102, 103)
    logNumber(<uint>a4.len())
    logNumber(<uint>a4.cap())
    logNumber(a4[0])
    logNumber(a4[7])
}

func variadic(fmt string, ...args []string) string {
    var result = fmt
    for(var i = 0; i < args.len(); i++) {
        result += args[i]
    }
    return result
}

func useVariadic() string {
    var s1 = variadic("fmt", "eins", "zwei", "drei")
    var arr = []string["uno", "dos", "tres"]
    return s1 + variadic("fmt2", ...arr)
}

func useDeconstruct() (string, int16, bool) {
    var a string
    var b int16
    var c bool
    a, (b, c) = ("Hallo", (42, true))
    return a, b, c
}
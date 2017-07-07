var g1 = i()
var g2 = "Hallo"
var g3 [256]byte

func globalSlice() []byte {
    return g3[:]
}

func demoSlice2() []int {
    var p #int = 1234
    return p[4:8] 
}

func demoSlice() []int {
    var arr [256]int
    var slice = arr[:]
    return slice[4:8]
}

func demoString() string {
    var buffer [256]byte
    var arr = buffer[:]
    return <string>arr
}

type S struct {
    x int
}

func someptr() {
    p().x = 12
}

func main() {
    &S{x: i()}
}

func main2() int {
    return a()[i()]
}

func i() int {
    return 42
}

func a() [3]int {
    return [1,2,3]
}

func p() *S {
    return &{x:11}
}

func demoTupleLiteral1() int16 {
    var tuple = (int16, string)(42, "Hallo!")
    return tuple[0]
}

func demoTupleLiteral2() (int16, string) {
    var tuple = (int16, string)(42, "Hallo!")
    return tuple
}

func demoTupleLiteral3() (int16, string) {
    return 42, "Hallo!"
}

func demoArrayLiteral2() int16 {
    var arr = [3]int16[3, 5, 8]
    return arr[0]
}
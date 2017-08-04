import . {
    func logString(string)
    func logNumber(int)
} from "imports"

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

func demoString2() string {
    return g2[0:2]
}

func demoString3() []byte {
    return <[]byte>g2
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

type P struct {
    p1 *int
    p2 *int
}

func p2() *P {
    return &{}
}

type Point struct {
    x int
    y int
}

func mul(p const volatile *Point) int {
    return p.x * p.y
}

func const volatile Point.mul() int {
    return mul(this)
}

func Point.wontWork() int {
    this.x++
    return this.x
}

func p3() Point {
    return {}
}

func p4() P {
    return {}
}

func usePoint() {
    p3().mul()
//    p3().wontWork()
    bar2(p4().p1)
//    bar3(&p4())
}

const pi = 3.14

func foo() {
    //pi = 3
    const answer = 42
    //answer = 43
    var i const int = 5
    var j const int = 6
    i = j + 1
    i++
    var p const *Point = &{x:1, y:2}
    bar(p)
    p.mul()
    //p.wontWork()
    //(*p).wontWork()
    var p2 *Point = &{x:1, y:2}
    bar(p2)
    p2.wontWork()
    p = p2
}

func bar(p const *Point) {
    logNumber(p.x)
}

func bar2(p *int) {

}

func bar3(p *P) {

}
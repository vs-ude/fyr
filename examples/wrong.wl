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

func mul(p const &Point) int {
    return p.x * p.y
}

func const &Point.mul() int {
    return mul(this)
}

func Point.wontWork() int {
    this.x++
    mul(this)
    return this.x
}

// func &Point.notAllowed() &Point {
func &Point.testme() Point {
//    var a &Point = this
    return *this
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
    //p3().x = 42
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
    const p3 const Point = *p2
    bar4(&p3)
    bar(&p3)

    const p4 Point = *p2
    bar4(&p4)
    bar(&p4)
    //p4.x = 0

    const hash []byte = [1,2,3,4]
    //hash[3] = 1

    const hash2 [4]byte = [1,2,3,4]
    //hash2[3] = 1

    demoString3()[4] = 1
    //arr()[3] = 1
    arr2()[0].x = 1
    //arr3()[0].x = 1
}

func arr() [4]byte {
    return [1,2,3,4]
}

func arr2() [1]*Point {
    return [&{x: 1, y:2}]
}

func arr3() [1]Point {
    return [{x: 1, y:2}]
}

func bar(p const *Point) {
    logNumber(p.x)
}

func bar4(p * const Point) {
}

func bar2(p *int) {
}

func bar3(p *P) {
}

func bar5(p &Point) {
    *p = {x:1, y:2}
}
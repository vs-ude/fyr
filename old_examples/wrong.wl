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
    logNumber(arr.len())
//    var slice const &[]int = arr[:]
    var slice = arr[:]
    return slice[4:8].clone()
}

func wrong(p &Point) {
    p.mul()
    var arr [1]&Point
    arr[0] = p
}

func wrong2() Point {
    var p Point
    return p
}

func wrong3() (int, int) {
    var a = (1, 2)
    return a
}

func wrong4() [1]Point {
    var arr [1]Point
    return arr
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

// TODO
func &Point.notAllowed() &Point {
    return this
}

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

func p5(p const &Point) {
    var copy Point = *p
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
    bar_ref(&p3)
    //bar(p3)

    const p4 Point = *p2
    bar_ref(&p4)
    //bar(p4)
    //p4.x = 0

    const hash []byte = [1,2,3,4]
    //hash[3] = 1

    const hash2 [4]byte = [1,2,3,4]
    //hash2[3] = 1

    demoString3()[4] = 1
    //arr()[3] = 1
    arr2()[0].x = 1
    //arr3()[0].x = 1

    const tuple = (42, Point{x: 1, y: 2})
    //tuple[0] = 1
    //tuple[1].x = 42
    bar(&tuple[1])
    //bar6(&tuple[1])

    const buf [4]byte = [1,2,3,4]
    //arr4(buf[:])
    arr5(buf[:])

    var buf2 []byte = [1, 2, 3]
    slice1(buf2)
    arr4(buf2)
    arr5(buf2)
    //arr4(buf[:])
    arr5(buf[:])
}

func slice1(s []byte) {
}

func arr() [4]byte {
    return [1,2,3,4]
}

func arr_b() [4]byte {
    const x [4]byte = [1,2,3,4]
    return x
}

func arr2() [1]*Point {
    return [&{x: 1, y:2}]
}

func arr3() [1]Point {
    return [{x: 1, y:2}]
}

func arr4(data &[]byte) {
    data[0] = 0
}

func arr5(data const &[]byte) {
    //data[0] = 0
}

func arr6(data [4]byte) {
    var slice = data[:]
}

func bar(p const *Point) {
    logNumber(p.x)
}

func bar_ref(p const &Point) {
}

func bar2(p *int) {
}

func bar3(p *P) {
}

func bar5(p &Point) {
    *p = {x:1, y:2}
}

func bar6(p *Point) {
}

type File struct {
    implements ReadWriter
}

func &File.Read(buffer []byte) (int, error) {
//func File.Read(buffer []byte) (n int, err error) {
    return 0, null
}

func const File.Write(buffer []byte) (int, error) {
//func File.Write(buffer []byte) (n int, err error) {
    return 0, null
}

type Reader interface {
    func Read(buffer []byte) (n int, err error)
}

type Writer interface {
    func Write(buffer []byte) (n int, err error)
}

type ReadWriter interface {
    extends Reader
    extends Writer
}

func useIface() {
    iface1(42)
    iface1(true)
    iface1(&Point{x:1, y:2})
    //iface2(&Point{x:1, y:2})
    iface3(42)

    // TODO var x int = iface5()
    // TODO iface1(x)

    var file = &File{}
    iface2(file)
    iface4(file)
}

func iface1(something interface{}) {
}

func iface2(bar IBar) {
}

func iface3(box interface{int16}) {
}

func iface4(io Reader & Writer) {
}

func iface5() interface{int} {
    return 42
}

type IBar interface {
    func Read(buffer []byte) (n int, err error)
}

type IFoo interface {
    extends IBar
    func Read(buffer []byte) (n int, err error)
}

type Point3D struct {
    extends Point
    z int
}

func use3D() int {
    var p Point3D
    return p.z + p.y + p.Point.x
    p.mul()
}

func uiui() {
    var arr [32]byte
    var slice &[]byte = arr[:]
}

func sqrt<F>(f F) F;

func sqrt(f float) float {

}

func sqrt(f double) double {
}

func isas(a interface{}) {
    if (var p = some.struct.x; p is *Point && p.x < 10) {

    }
}
import . {
    func logString(string)
    func logNumber(uint)
} from "imports"

type IFoo interface {
    func Hudel()
    func Dudel()
}

type S struct {
    x int
}

func S.Hudel() {
    logString("S -> Hudel")
}

func S.Dudel() {
}

func S.AberAber() {
}

type S2 struct {
}

func S2.Hudel() {
    logString("S2 -> Hudel")
}

func S2.Dudel() {
}

func create() IFoo {
    return &S{}
}

func create2() IFoo {
    return &S2{}
}

func main() {
    var iface = create()
    iface.Hudel()
    iface = create2()
    iface.Hudel()
}

func dummy(arg &[]byte, arg2 []&S) {
    var buf [256]byte
    var slice = buf[:]
    var arr []&IFoo
    var s S
    arr[0] = &s
    var ptr &int = &s.x
    if (buf[0] == 0) {
        var ptr2 &int = &s.x
        var buf2 [256]byte
        var slice2 = buf2[:]
        slice2 = buf[:]
        buf = buf2
        slice2 = arg
        var s2 S
//        arr[0] = &s2
        ptr = &s.x
    }
    arg[0] = 45
//    arg2[0] = arg2[1]
//    arg = slice
//    arg2[0] = &s
}

func mapDemo() int {
    var m map<string, int> = {bar: 21, foo: 42, hudel: 11}
    m["dodo"] = 123
    m["bar"] = 22
    logString("Reading")
    logNumber(<uint>m["bar"])
    logNumber(<uint>m["foo"])
    logNumber(<uint>m["hudel"])
    logNumber(<uint>m["dodo"])
    m.remove("bar")
    return m["foo"]
}

func mapDemo2() int {
    var m map<&S, int> = {}
    var s1 S
    var s2 S
    var s3 S
    m[&s1] = 1
    m[&s2] = 2
    m[&s3] = 3
    logString("Reading")
    logNumber(<uint>m[&s1])
    logNumber(<uint>m[&s2])
    logNumber(<uint>m[&s3])
    logString("Removing")
    m.remove(&s1)
    logString("Reading 2")
    logNumber(<uint>m[&s2])
    logString("Returning")
    return m[&s2]
}

type T1 struct {
}

type T2 struct {
    extends T1
}

func typeTest() {
    var t1 T1
    var t2 T2
    var p = &t1
    p = &t2
}
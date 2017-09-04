import . {
    func logString(string)
    func logNumber(uint)
} from "imports"

type IFoo interface {
    func Hudel()
    func Dudel()
}

type S struct {
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

func dummy(arg &[]byte) {
    var buf [256]byte
    var slice = buf[:]
    var arr []&IFoo
    var s S
    arr[0] = &s
    if (buf[0] == 0) {
        var buf2 [256]byte
        var slice2 = buf2[:]
        slice2 = buf[:]
        buf = buf2
        slice2 = arg
        var s2 S
        arr[0] = &s2
    }
    arg = slice
}
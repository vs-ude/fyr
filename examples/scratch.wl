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
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

func create() IFoo {
    return &S{}
}

func main() {
    var iface = create()
    iface.Hudel()
}
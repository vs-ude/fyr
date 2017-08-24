type IFoo interface {
    func Hudel()
    func Dudel()
}

type S struct {
}

func S.Hudel() {
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
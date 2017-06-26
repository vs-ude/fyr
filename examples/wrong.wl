type S struct {
    x int
}

func main() {
    &S{x: i()}
}

func i() int {
    return 42
}
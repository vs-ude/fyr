func getTuple() (int, int) {
    return 82, 164
}

func useTuple() int {
    var a int
    var b int
    a, b = getTuple()
    return a + b
}

func main() string {
    var name = "Fred " + action()
    return name
}

func action() string {
    return "sucks"
}

func fuck() string {
    return action1() + "x" + action2()
}

func action1() string {
    return "A1"
}

func action2() string {
    return "A2"
}

func action3() string {
    return "A3"
}

func dummy() string {
    return action1() + action2() + action3()
}

type Point struct {
    x int
    y int
}

func newPoint() Point {
    return {x: 42, y: 84}
}

func allocPoint() *Point {
    return &{x: 42, y: 84}
}

func translate() Point {
    var p = newPoint()
    p.x += 2
    return p
}

func toX() int {
    return newPoint().y
}

type Rect struct {
    p1 Point
    p2 Point
}

func newRect() Rect {
    return {p1: {x: 42, y: 84}, p2: {x: 168, y: 336}}
}
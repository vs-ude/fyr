import . {
    func logString(string)
    func logNumber(uint)
} from "imports"

import "fyr/system"

type Point struct {
    x int
    y int
    next *Point
}

var p *Point

func main() *Point {
    logString("Hello from main")
    var tmp = &Point{x:20, y: 22}
    logNumber(<uint><#Point>tmp)
    p = &{x: 10, y: 11, next: tmp}
    logNumber(<uint><#Point>p)
    tmp = &{x:20, y: 22}
    logNumber(<uint><#Point>tmp)
    useless(tmp)
    return &{x: 42, y:84, next: tmp}
}

func useless(p *Point) {
    // Enforce a garbage collection
    system.garbageCollect()
}
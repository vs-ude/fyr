import . {
    func logString(string)
    func logNumber(uint)
} from "imports"

type Point struct {
    x int
    y int
}

var p *Point

func main() *Point {
    p = &{x: 10, y: 11}
    logNumber(<uint><#Point>p)
    return &{x: 42, y:84}
}
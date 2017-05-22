import {
    func logNumber(int)
} from "imports"

type Rect struct {
    x int
    y int
}

func demoRect(x int, y int) Rect {
    var r Rect
    r.x = x
    r.y = y;
    logNumber(r.y);   
    return r    
}
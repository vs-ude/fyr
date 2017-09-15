package main

// Rect is
type Rect struct {
	pos  Point
	size Size
}

// Point is
type Point struct {
	x int
	y int
}

// Size is
type Size struct {
	width  int
	height int
}

// Include is
func (r *Rect) Include(p Point) Rect {
	var result = *r
	if p.x < r.pos.x {
		result.size.width = r.size.width + r.pos.x - p.x
		result.pos.x = p.x
	} else if p.x >= r.pos.x+r.size.width {
		result.size.width = p.x - r.pos.x + 1
	}
	if p.y < r.pos.y {
		result.size.height = r.size.height + r.pos.y - p.y
		result.pos.y = p.y
	} else if p.y >= r.pos.y+r.size.height {
		result.size.height = p.y - r.pos.y + 1
	}
	return result
}

func main() {
	var r Rect
	r.pos.x = 12
	r.pos.y = 23
	r.size.width = 2
	r.size.height = 3
	for i := 0; i < 320000000; i++ {
		r = r.Include(Point{x: i % 100, y: i % 200})
	}
	println(r.pos.x, r.pos.y, r.size.width, r.size.height)
}

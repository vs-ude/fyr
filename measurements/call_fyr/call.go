package main

// Point is
type Point struct {
	a int
	b int
}

func doit(ptr *Point) int {
	return ptr.a + ptr.b
}

func main() {
	var p = &Point{a: 1, b: 2}
	//	g = p
	var r = 0
	for i := 0; i < 320000000; i++ {
		r += doit(p)
	}
	println(r)
}

type Sembedded struct {
    x int
    arr []int    
}

type S struct {
    s string
    arr []int
    e Sembedded
}

func ptr1() byte {
    var x = "Hallo"
    return x[idx()]
}

func ptr2() {
    var arr = [1,2,3]
    arr[idx()] = idx()
}

func ptr3(p *S) byte {
    return p.s[idx()]
}

func ptr4(p *S) {
    p.arr[idx()] = idx()
}

func ptr5(p *S) {
    p.e.arr[idx()] = idx()
}

func ptr6() int {
    return arr()[1]
}

func ptr7() int {
    return vec()[1]
}

func ptr8() int {
    return tuple()[1]
}

func idx() int {
    return 2
}

func vec() [3]int {
    return [1,2,3]
}

func arr() []int {
    return [1,2,3]
}

func tuple() (float, int) {
    return 1.2, 2
}
import {
    func logNumber(int)
} from "imports"

func measureRecursion() {
    for(var i = 0; i < 100000; i++) {
        recursion(1000)
    }
}

func recursion(a int) int {
    if (a == 0) {
        return 0
    }
    return a + recursion(a-1)
}
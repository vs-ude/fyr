import {
    func logNumber(int)
} from "imports"

func main() int {
    var arr = [2,4,8,16,32,42]
    for(var i in arr) {
        logNumber(i)
    }
    return arr[0]
}

func main2() int {
    var arr = [2,4,8,16,32,42]
    var s = {val: 0}
    for(s.val in arr) {
        logNumber(s.val)
    }
    return arr[0]    
}

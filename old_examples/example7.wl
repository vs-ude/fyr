import . {
    func logNumber(int)
} from "imports"

func loop1() int {
    var arr = [2,4,8,16,32,42]
    for(var v in arr) {
        logNumber(v)
    }
    return arr[0]
}

func loop2() int {
    var arr = [2,4,8,16,32,42]
    var s = {val: 0}
    for(s.val in arr) {
        logNumber(s.val)
    }
    return arr[0]    
}

func loop3() double {
    var arr = [2.1, 3.2, 4.3, 5.4]
    for(var i, v in arr) {
        logNumber(i)
    }
    return arr[0]
}

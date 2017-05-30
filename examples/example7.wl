import {
    func logNumber(int)
} from "imports"

func main() *int {
    var arr = [2,4,8,16,32,42]
    for(var i in arr) {
//        logNumber(i)
        return &i
    }
    return &arr[0]
}

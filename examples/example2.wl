//some
//comment
func f<A, B is double>(x int, y B, z int, b byte, s string, bo bool, p *string,
                       tuple (int, float), tuple2 (int, bool), arr [3]int, slice []int,
                       fu func(int) double, t map<string,int>, t2 map<string,int>,
                       en "red" | "green", en2 "green" | "red",
                       o1 int | string | "a" | "b", o2 string | "b" | "a" | int = "x") (r1 int | bool, r2 string) {
    r1 = x
    r2 == "Welt"
    +x + z
    ^x + 1 << z
    b + 2 % b
    -y + 1.5
    s + "Hallo" + "Welt"
    "Hallo" + s
    bo == !(s < "Hallo")
    *p
    &bo
    &s == p
    tuple == tuple
    x == tuple[0]
    x == arr[z]
    x == slice[z]
    t == t2
    y == fu(x)
    f<int, double>(x, y, z, b, s, bo, p, tuple, tuple2, arr, slice, fu, t, t2, en, en2, o1, o2)
    f<int, double>(x, y, z, b, s, bo, p, tuple, tuple2, arr, slice, fu, t, t2, en, en2, o1)
    en == en2
    o1 == o2
    b == 1 + 2 ^ 7
    b == ^-1
    bo == (5 == 3)
    bo == ("Hallo" != "Welt")
    o1 == "Hallo"
    o1 == "a"
    var v int, v1 bool
    v == x
    v1 != bo
    var v2 = 5
    var v3 byte = 8
    var v4 "a" | "b" = "b"
    var v5, v6 "Huhu" | "Hallo" = (5, "Huhu")
    var (v7 byte, v8, ...v9) = (5, "Huhu", 1, 2)
    var v10 (int, int) = v9
    var (v11 byte, v12, ...v13 (byte, byte)) = (5, "Huhu", 1, 2)
    var (v14, (v15, v16), v17) = (1, (2, 3), 4)
    var [c1, c2, c3?, ...c4] = "Hallo";
    var [c5 byte, c6? byte, ...c7 string] = "Hallo";
    var [ax1, ...ax2] = arr
    var [ax3 int, ...ax4 [2]int] = arr
    var [ax7, ax8?, ...ax9] = slice
    var [ax10 int, ax11?, ...ax12 []int] = slice
    var [ch1, ch2?, ...ch3] = "Hallo"
    ch3 == "llo"
    ch1 == b
    ch2 == b
    var [ax5 byte, ax6 byte] = [1, 2]
    var [ax13, ax14] = [1, 2]
    var [ax15, ...ax16] = [1, 2, 3]
    var jarr []json
    ax15 == 1
    ax16 == jarr
    var [ax17, ...ax18 []byte] = [1, 2, 3]
    var [ax19, ...ax20 [2]byte] = [1, 2, 3]
    var [ax21, (ax22, ax23)] = [1, (2, 3.14)]
    y == ax23
    var j json
    var [jj1, jj2?, ...jj3], _ = j
    jj1 != j
    jj2 != j    
    jj3 != jarr
    if (bo) {
        bo == false
    }
    if (var j = "Dudu"; j == "Hallo") {
        j + "Foo"
        x++
        x--
        return 3, "Super"
    } else if (var j = 4; j < x) {
        j + x
        var retuple = (3, "Foo")
        return retuple
    } else {
        x * x
        return
    }
    if (var x string; j == jj2) {
        x + "Foo"
    } else {
        x++
    }
    for {
        x++
    }
    for (var a = 0; a < 10; a++) {
        if (a == x) {
            continue
        }
    }
    for (x < z) {
        x++
        break
    }
    var fx func (byte, "a" | "b")
    fx(1, "a")
    var fe func (string, ...[]string)
    fe("a", "b", "c")
    b == (*p)[0]
    var mapme map<*string, bool>
    bo == mapme[p]
    var fa func([]int)
    fa([1,2,3])
    var fb func(bool | int)
    fb(x)
    var [q1, q2 int | bool] = [1, 2]
    var fopt func(int, string?)
    fopt(5)
    var o3 int | "a" | "b" = x
    var o4 int | "a" | "b" = "a"
    var fc func([][]int)
    fc([[1,2],[3, 4]])
    var jsonarr = [1, 2, 3]
    jsonarr == j
    var ss [][]int = [[1,2],[3, 4]]
    var j2, err = j[x]
    var err2 error
    err == err2
    j2 == j
    var untyped = ([1,2],3)
    jsonarr == untyped[0]
    x == untyped[1]
    var untyped2 = [[1,2],[3,4]]
    var typed ([]int, int) = ([1,2],3)
    var typed2 ([]json, int) = ([1,2],3)
    var tt1, _ = (1, 2)
    var _, tt2 = ("x", "y")
    var [jt1, jt2, ...jt3], err3 = j
    var jt4 int, err4 = j
    var [xjt1, xjt2, ...xjt3], _ = j
    var obj map<string,json> = {foo: 1 + 2, arr: [1, 2]}
    var obj2 = {foo: 1 + 2, arr: [1, 2]}
    obj2 == j
    var {x: ox, y?: oy, ...or}, _ = j
    ox == j
    oy == j
    or == obj
    var {x: ox2 int, y?: oy2 string, ...or2 map<string,json>}, _ = j
    ox2 == x
    oy2 == "Hallo"
    or2 == obj
    var {x: ox3 int, y?: oy3 string, ...or3 json}, _ = j
    {x: ox3, y?: oy3, ...or3}, _ = j
    s += "Hallo"
    x += 1   
    var lambda = func(a string, b string) => a + b
    s = lambda("Foo", "Bar")
    for (s, j in obj) {
        continue
    }
    for (_, j in obj) {
        continue
    }
    for (s in obj) {
        break
    }
    for (var s string, j json in obj) {
        continue
    }
    for (var _, j json in obj) {
        continue
    }
    for (var s string in obj) {
        break
    }
    for (var a, b in obj) {
        continue
    }
    for (var _, b in obj) {
        continue
    }
    for (var a in obj) {
        break
    }
    return (2, "Hallo")
}
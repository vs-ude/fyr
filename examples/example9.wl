func main() string {
    var name = "Fred " + action()
    return name
}

func action() string {
    return "sucks"
}

func fuck() string {
    return action1() + "x" + action2()
}

func action1() string {
    return "A1"
}

func action2() string {
    return "A2"
}

func action3() string {
    return "A3"
}

func dummy() string {
    return action1() + action2() + action3()
}
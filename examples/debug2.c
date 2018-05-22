#include <stdint.h>
#include <stdlib.h>
#include "fyr.h"

struct localSlice {
    addr_t data_ptr;
    int_t data_length;
};

struct Point {
    int64_t x;
};

struct strongSlice {
    struct localSlice base;
    addr_t array_ptr;
};

int64_t f_main();
void f_init();
void f_dtr_u0(addr_t v_pointer);
int main(int argc, char** argv);

int64_t f_main() {
    struct strongSlice v_p;
    addr_t nr_0;
    addr_t nr_5;
    int_t nr_7;
    int64_t nr_11;
    /* $return = decl_result s64  */;
    /* p = decl_var strongSlice  */;
    /* $mem = store Point (%0 = alloc_arr Point 2, 8), 0, (struct Point 42) */;
    *(struct Point*)(nr_0 = fyr_alloc_arr(2, 8)) = (struct Point){42};
    /* $mem = store Point %0, 8, (struct Point 13) */;
    *(struct Point*)((char*)nr_0 + 8) = (struct Point){13};
    /* %5 = member addr (member localSlice (p = struct strongSlice %0, 2, %0), 0), 0 */;
    nr_5 = ((v_p = (struct strongSlice){nr_0, 2, nr_0}).base).data_ptr;
    /* %7 = member sint (member localSlice p, 0), 1 */;
    nr_7 = (v_p.base).data_length;
    /* if (ge_u i8 %8, %7) */;
    if ((uint_t)1 >= (uint_t)nr_7) {
        /* trap  */;
        exit(EXIT_FAILURE);
    };
    /* %11 = member s64 (load Point %5, 8), 0 */;
    nr_11 = (*(struct Point*)(nr_5 + 8)).x;
    /* call (addr) => () 2, (addr_of addr p) */;
    f_dtr_u0((addr_t)(&v_p));
    /* return s64 %11 */;
    return nr_11;
    /* end  */;
}

void f_init() {

}

void f_dtr_u0(addr_t v_pointer) {
    addr_t nr_13;
    /* pointer = decl_param addr  */;
    /* if (ne addr (%13 = load addr pointer, 16), 0) */;
    if ((nr_13 = *(addr_t*)(v_pointer + 16)) != 0) {
        /* free_arr %13 */;
        fyr_free_arr(nr_13);
    };
    /* end  */;
}

int main(int argc, char** argv) {
    f_init();
    return f_main();
}


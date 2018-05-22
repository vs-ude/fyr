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

struct ta_struct0 {
    struct Point field0[2];
};

int64_t f_main();
int64_t f_refme(addr_t v_p);
int64_t f_localme(addr_t v_p);
void f_init();
void f_dtr_u0(addr_t v_pointer);
void f_dtr_u1(addr_t v_pointer);
void f_dtr_u2(addr_t v_pointer, int_t v_size);
int main(int argc, char** argv);

int64_t f_main() {
    struct strongSlice v_slice;
    struct ta_struct0 v_arr;
    addr_t v_p;
    addr_t v_r;
    addr_t nr_1;
    addr_t nr_0;
    addr_t nr_3;
    addr_t nr_7;
    addr_t nr_11;
    int_t nr_13;
    addr_t nr_16;
    int64_t nr_17;
    int64_t nr_21;
    int64_t nr_23;
    int64_t nr_27;
    /* $return = decl_result s64  */;
    /* slice = decl_var strongSlice  */;
    /* arr = decl_var struct{...}  */;
    /* [gc]p = decl_var ptr  */;
    /* [gc]r = decl_var ptr  */;
    /* $mem = store Point (%1 = alloc Point ), 0, (struct Point 0) */;
    *(struct Point*)(nr_1 = fyr_alloc(8)) = (struct Point){0};
    /* $mem = store ptr ([gc]%0 = alloc_arr ptr 2, 8), 0, %1 */;
    *(addr_t*)(nr_0 = fyr_alloc_arr(2, 8)) = nr_1;
    /* $mem = store Point (%3 = alloc Point ), 0, (struct Point 0) */;
    *(struct Point*)(nr_3 = fyr_alloc(8)) = (struct Point){0};
    /* $mem = store ptr [gc]%0, 8, %3 */;
    *(addr_t*)((char*)nr_0 + 8) = nr_3;
    /* arr = struct struct{...} 0, 0 */;
    v_arr = (struct ta_struct0){0, 0};
    /* $mem = store Point (%7 = alloc Point ), 0, (struct Point 0) */;
    *(struct Point*)(nr_7 = fyr_alloc(8)) = (struct Point){0};
    /* [gc]r = incref addr ([gc]p = copy ptr %7) */;
    v_r = fyr_incref(v_p = nr_7);
    /* %11 = member addr (member localSlice (slice = struct strongSlice [gc]%0, 2, [gc]%0), 0), 0 */;
    nr_11 = ((v_slice = (struct strongSlice){nr_0, 2, nr_0}).base).data_ptr;
    /* %13 = member sint (member localSlice slice, 0), 1 */;
    nr_13 = (v_slice.base).data_length;
    /* if (ge_u i8 %14, %13) */;
    if ((uint_t)0 >= (uint_t)nr_13) {
        /* trap  */;
        exit(EXIT_FAILURE);
    };
    /* incref addr ([gc]%16 = load ptr %11, 0) */;
    fyr_incref(nr_16 = *(addr_t*)nr_11);
    /* %17 = call (ptr) => (s64) 1, [gc]%16 */;
    nr_17 = f_refme(nr_16);
    /* decref [gc]%16, 4 */;
    fyr_decref(nr_16, f_dtr_u0);
    /* %21 = add s64 %17, (call (ptr) => (s64) 1, [gc]p) */;
    nr_21 = nr_17 + f_refme(v_p);
    /* %23 = add s64 %21, (call (ptr) => (s64) 1, [gc]r) */;
    nr_23 = nr_21 + f_refme(v_r);
    /* %27 = add s64 %23, (call (ptr) => (s64) 2, (add ptr (addr_of addr arr), 8)) */;
    nr_27 = nr_23 + f_localme((addr_t)(&v_arr) + 8);
    /* call (addr) => () 5, (addr_of addr slice) */;
    f_dtr_u1((addr_t)(&v_slice));
    /* if (ne addr [gc]p, 0) */;
    if (v_p != 0) {
        /* free [gc]p */;
        fyr_free(v_p);
    };
    /* if (ne addr [gc]r, 0) */;
    if (v_r != 0) {
        /* decref [gc]r, -1 */;
        fyr_decref(v_r, 0);
    };
    /* return s64 %27 */;
    return nr_27;
    /* end  */;
}

int64_t f_refme(addr_t v_p) {
    /* p = decl_param ptr  */;
    /* $return = decl_result s64  */;
    /* if (eqz addr p) */;
    if (v_p == 0) {
        /* trap  */;
        exit(EXIT_FAILURE);
    };
    /* return s64 (load s64 p, 0) */;
    return *(int64_t*)v_p;
    /* end  */;
}

int64_t f_localme(addr_t v_p) {
    /* p = decl_param ptr  */;
    /* $return = decl_result s64  */;
    /* if (eqz addr p) */;
    if (v_p == 0) {
        /* trap  */;
        exit(EXIT_FAILURE);
    };
    /* return s64 (load s64 p, 0) */;
    return *(int64_t*)v_p;
    /* end  */;
}

void f_init() {

}

void f_dtr_u0(addr_t v_pointer) {
    addr_t nr_18;
    /* pointer = decl_param addr  */;
    /* if (ne addr (%18 = load addr pointer, 0), 0) */;
    if ((nr_18 = *(addr_t*)v_pointer) != 0) {
        /* free %18 */;
        fyr_free(nr_18);
    };
    /* end  */;
}

void f_dtr_u1(addr_t v_pointer) {
    addr_t nr_29;
    /* pointer = decl_param addr  */;
    /* if (ne addr (%29 = load addr pointer, 16), 0) */;
    if ((nr_29 = *(addr_t*)(v_pointer + 16)) != 0) {
        /* call (addr,sint) => () 6, %29, (load sint %29, -8) */;
        f_dtr_u2(nr_29, *(int_t*)(nr_29 + -8));
        /* free_arr %29 */;
        fyr_free_arr(nr_29);
    };
    /* end  */;
}

void f_dtr_u2(addr_t v_pointer, int_t v_size) {
    int_t nr_31;
    addr_t nr_33;
    /* pointer = decl_param addr  */;
    /* size = decl_param sint  */;
    /* %31 = const sint 0 */;
    nr_31 = (int_t)0;
    /* block  */;
    /* loop  */;
    block1:;
    /* br_if (eq sint %31, size), 1 */;
    if (nr_31 == v_size) {
        goto block0;
    };
    /* if (ne addr (%33 = load addr pointer, 0), 0) */;
    if ((nr_33 = *(addr_t*)v_pointer) != 0) {
        /* free %33 */;
        fyr_free(nr_33);
    };
    /* pointer = add addr pointer, 8 */;
    v_pointer = v_pointer + 8;
    /* %31 = add addr %31, 1 */;
    nr_31 = nr_31 + 1;
    /* end of loop */;
    goto block1;
    /* end of block */;
    block0:;
    /* end  */;
}

int main(int argc, char** argv) {
    f_init();
    return f_main();
}


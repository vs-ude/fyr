#include "fyr.h"
#include <stdlib.h>
#include <limits.h>

#include <stdio.h>

addr_t fyr_alloc(size_t count, size_t size) {
    int_t* ptr = calloc(count * size + sizeof(int_t), 1);
    *ptr = 1;
    return (addr_t)++ptr;
}

void fyr_free(addr_t ptr) {
    int_t* iptr = ((int_t*)ptr) - 1;
    if (*iptr == 1) {
        // No further references, Give up all memory
        free(iptr);
    } else {
        printf("REALLOC\n");
        // References exist. Decrease the reference count and realloc.
        // The remaining memory does not need to be destructed.
        *iptr = INT_MIN + *iptr - 1;
        // TODO: Use implementation of realloc that ensures that data does not move while shrinkink
        (void)realloc(iptr, sizeof(int_t));
    }
}

inline bool fyr_isnull(addr_t ptr) {
    return *(((int_t*)ptr) - 1) <= 0;
}

inline addr_t fyr_incref(addr_t ptr) {
    int_t* iptr = ((int_t*)ptr) - 1;
    (*iptr)++;
    return ptr;
}

void fyr_decref(addr_t ptr, fyr_dtr_t dtr) {
    int_t* iptr = ((int_t*)ptr) - 1;
    if (--(*iptr) == 0) {
        // Reference count can drop to zero only when the owning pointer has been assigned
        // to a frozen pointer and all references have been removed.
        // Hence, a destructor must run.
        if (dtr) dtr(ptr);
        free(iptr);
    } else if (*iptr == INT_MIN) {
        printf("Free refcounter\n");
        // The owning pointer is zero (no freeze) and now all remaining references have been removed.
        free(iptr);
    }
}
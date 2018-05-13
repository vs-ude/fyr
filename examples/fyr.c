#include "fyr.h"
#include <stdlib.h>
#include <limits.h>
#include <stdbool.h>

void* fyr_alloc(size_t count, size_t size) {
    int_t* ptr = calloc(count * size + sizeof(int_t), 1);
    *ptr = 1;
    return ++ptr;
}

void fyr_free(void *ptr) {
    int_t* iptr = ((int_t*)ptr) - 1;
    if (*iptr == 1) {
        // No further references, Give up all memory
        free(iptr);
    } else {
        // References exist. Decrease the reference count and realloc.
        // The remaining memory does not need to be destructed.
        *iptr = INT_MIN + *iptr - 1;
        // TODO: Use implementation of realloc that ensures that data does not move while shrinkink
        (void)realloc(iptr, sizeof(int_t));
    }
}

inline bool fyr_isnull(void *ptr) {
    return *(((int_t*)ptr) - 1) <= 0;
}

inline void fyr_incref(void *ptr) {
    int_t* iptr = ((int_t*)ptr) - 1;
    (*iptr)++;
}

void fyr_decref(void *ptr, fyr_dtr_t dtr) {
    int_t* iptr = ((int_t*)ptr) - 1;
    if (--(*iptr) == 0) {
        // Reference count can drop to zero only when the owning pointer has been assigned
        // to a frozen pointer and all references have been removed.
        // Hence, a destructor must run.
        if (dtr) dtr(ptr);
        free(iptr);
    } else if (*iptr == INT_MIN) {
        // The owning pointer is zero (no freeze) and now all remaining references have been removed.
        free(iptr);
    }
}
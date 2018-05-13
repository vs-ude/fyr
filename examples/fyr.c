#include "fyr.h"
#include <stdlib.h>
#include <limits.h>

void* fyr_alloc(size_t count, size_t size) {
    int_t* ptr = calloc(count * size + sizeof(int_t), 1);
    *ptr = 1;
    return ptr++;
}

void fyr_free(void *ptr) {
    int_t* iptr = ((int_t*)ptr) - 1;
    if (*iptr == 1) {
        // No further references
        free(iptr);
    } else {
        // References exist. Decrease the reference count and realloc
        (*iptr)--;
        // TODO: Use implementation of realloc that ensures that data does not move while shrinkink
        realloc(iptr, sizeof(int_t));
    }
}

void fyr_freeze(void *ptr) {
    int_t* iptr = ((int_t*)ptr) - 1;
    *iptr = INT_MIN + *iptr;
}

inline void fyr_incref(void *ptr) {
    int_t* iptr = ((int_t*)ptr) - 1;
    (*iptr)++;
}

void fyr_decref(void *ptr, fyr_dtr_t dtr) {
    int_t* iptr = ((int_t*)ptr) - 1;
    if (--(*iptr) == 0) {
        free(iptr);
    } else if (*iptr == INT_MIN) {
        if (dtr) dtr(ptr);
        free(iptr);
    }
}
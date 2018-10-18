#include "fyr.h"
#include <stdlib.h>
#include <limits.h>

// #include <stdio.h>

addr_t fyr_alloc(int_t size) {
    // TODO: If int_t is larger than size_t, the size could be shortened.
    int_t* ptr = calloc(1, (size_t)size + sizeof(int_t));
    // printf("calloc %lx\n", (long)ptr);
    *ptr++ = 1;
    return (addr_t)ptr;
}

addr_t fyr_alloc_arr(int_t count, int_t size) {
    int_t* ptr = calloc(1, (size_t)count * (size_t)size + 2 * sizeof(int_t));
    // printf("calloc arr %lx\n", (long)ptr);
    *ptr++ = 1;
    *ptr++ = count;
    return (addr_t)ptr;
}

void fyr_free(addr_t ptr) {
    int_t* iptr = ((int_t*)ptr) - 1;
    if (*iptr == 1) {
        // No further references, Give up all memory
        // printf("Free %lx\n", (long)iptr);
        free(iptr);
    } else {
        // printf("REALLOC %lx\n", (long)iptr);
        // References exist. Decrease the reference count and realloc.
        // The remaining memory does not need to be destructed.
        *iptr = INT_MIN + *iptr - 1;
        // TODO: Use implementation of realloc that ensures that data does not move while shrinkink
        (void)realloc(iptr, sizeof(int_t));
    }
}

void fyr_free_arr(addr_t ptr) {
    int_t* iptr = ((int_t*)ptr) - 2;
    if (*iptr == 1) {
        // No further references, Give up all memory
        // printf("Free arr %lx\n", (long)iptr);
        free(iptr);
    } else {
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

inline bool fyr_isnull_arr(addr_t ptr) {
    return *(((int_t*)ptr) - 2) <= 0;
}

inline addr_t fyr_incref(addr_t ptr) {
    int_t* iptr = ((int_t*)ptr) - 1;
    (*iptr)++;
    return ptr;
}

inline addr_t fyr_incref_arr(addr_t ptr) {
    int_t* iptr = ((int_t*)ptr) - 2;
    (*iptr)++;
    return ptr;
}

void fyr_decref(addr_t ptr, fyr_dtr_t dtr) {
    int_t* iptr = ((int_t*)ptr) - 1;
    // printf("DECREF %lx\n", (long)iptr);
    if (--(*iptr) == 0) {
        // Reference count can drop to zero only when the owning pointer has been assigned
        // to a frozen pointer and all references have been removed.
        // Hence, a destructor must run.
        if (dtr) dtr(ptr);
        // printf("DECREF FREE %lx\n", (long)iptr);
        free(iptr);
    } else if (*iptr == INT_MIN) {
//        printf("Free refcounter\n");
        // The owning pointer is zero (no freeze) and now all remaining references have been removed.
        // printf("DECREF FREE %lx\n", (long)iptr);
        free(iptr);
    }
}

void fyr_decref_arr(addr_t ptr, fyr_dtr_arr_t dtr) {
    int_t* iptr = ((int_t*)ptr) - 2;
    if (--(*iptr) == 0) {
        // Reference count can drop to zero only when the owning pointer has been assigned
        // to a frozen pointer and all references have been removed.
        // Hence, a destructor must run.
        if (dtr) dtr(ptr, *(iptr+1));
        free(iptr);
    } else if (*iptr == INT_MIN) {
        // The owning pointer is zero (no freeze) and now all remaining references have been removed.
        free(iptr);
    }
}

inline int_t fyr_len_arr(addr_t ptr) {
    if (ptr == 0) {
        return 0;
    }
    return *(((int_t*)ptr)-1);
}
#include "fyr.h"
#include <stdlib.h>
#include <limits.h>
#include <assert.h>
#include <string.h>

#include <stdio.h>
#define VALGRIND 1

addr_t fyr_alloc(int_t size) {
    // TODO: If int_t is larger than size_t, the size could be shortened.
    int_t* ptr = calloc(1, (size_t)size + 2 * sizeof(int_t));
    // printf("calloc %lx\n", (long)ptr);
    // No locks
    *ptr++ = 0;
    // One owner
    *ptr++ = 1;
    return (addr_t)ptr;
}

addr_t fyr_alloc_arr(int_t count, int_t size) {
    int_t* ptr = calloc(1, (size_t)count * (size_t)size + 2 * sizeof(int_t));
    // printf("calloc arr %lx\n", (long)ptr);
    // One owner
    *ptr++ = 1;
    // Number of elements in the array
    *ptr++ = count;
    return (addr_t)ptr;
}

void fyr_free(addr_t ptr, fyr_dtr_t dtr) {
    if (ptr == NULL) {
        return;
    }

    int_t* lptr = ((int_t*)ptr) - 2;
    int_t* iptr = ((int_t*)ptr) - 1;
    if (*iptr == 1) {
        // No further references, Give up all memory
        // printf("Free %lx\n", (long)iptr);
        if (*lptr == 0) {            
            // No one holds a lock on it.
            if (dtr) dtr(ptr);
            free(lptr);
        } else {
            *iptr = 0;
        }
    } else {
        // printf("REALLOC %lx %lx\n", (long)*iptr, (long)(INT_MIN + *iptr - 1));
        // References exist. Decrease the reference count and realloc.
        // The remaining memory does not need to be destructed.
        *iptr = INT_MIN + *iptr - 1;        
        // TODO: Use implementation of realloc that ensures that data does not move while shrinking
        if (*lptr == 0) {
            if (dtr) dtr(ptr);
#ifndef VALGRIND
            // No one holds a lock on it.    
            void* ignore = realloc(lptr, 2 * sizeof(int_t));
            assert(ignore == lptr);
#endif
        }
    }
}

void fyr_free_arr(addr_t ptr, fyr_dtr_arr_t dtr) {
    if (ptr == NULL) {
        return;
    }

    int_t* iptr = ((int_t*)ptr) - 2;
    if (*iptr == 1) {
        // No further references, Give up all memory
        // printf("Free arr %lx\n", (long)iptr);
        if (dtr) dtr(ptr, *(((int_t*)ptr) - 1));
        free(iptr);
    } else {
        // References exist. Decrease the reference count and realloc.
        // The remaining memory does not need to be destructed.
        *iptr = INT_MIN + *iptr - 1;
        // TODO: Use implementation of realloc that ensures that data does not move while shrinkink
        if (dtr) dtr(ptr, *(((int_t*)ptr) - 1)); 
        void* ignore = realloc(iptr, sizeof(int_t));
        assert(ignore == iptr);
    }
}

bool fyr_isnull(addr_t ptr) {
    return ptr == NULL || (*(((int_t*)ptr) - 1) <= 0 && *(((int_t*)ptr) - 2) == 0);
}

bool fyr_isnull_arr(addr_t ptr) {
    return ptr == NULL || *(((int_t*)ptr) - 2) <= 0;
}

void fyr_notnull_ref(addr_t ptr) {
    if (ptr == NULL || (*(((int_t*)ptr) - 1) <= 0 && *(((int_t*)ptr) - 2) == 0)) {
        exit(EXIT_FAILURE);
    }
}

addr_t fyr_incref(addr_t ptr) {
    if (ptr == NULL) {
        return NULL;
    }
    int_t* iptr = ((int_t*)ptr) - 1;
    (*iptr)++;
    return ptr;
}

addr_t fyr_incref_arr(addr_t ptr) {
    if (ptr == NULL) {
        return NULL;
    }
    int_t* iptr = ((int_t*)ptr) - 2;
    (*iptr)++;
    return ptr;
}

void fyr_decref(addr_t ptr, fyr_dtr_t dtr) {
    if (ptr == NULL) {
        return;
    }
    // Number of locks
    int_t* lptr = ((int_t*)ptr) - 2;
    // Number of references
    int_t* iptr = ((int_t*)ptr) - 1;
    // printf("DECREF %lx\n", (long)*iptr);
    (*iptr)--;
    if (*iptr == 0) {
        // Reference count can drop to zero only when the owning pointer has been assigned
        // to a frozen pointer and all references have been removed.
        // Hence, a destructor must run.
        if (*lptr == 0) {
            if (dtr) dtr(ptr);
            // printf("DECREF FREE %lx\n", (long)iptr);
            free(lptr);
        }
    } else if (*iptr == INT_MIN) {
        // printf("Min count reached\n");
        // The owning pointer is gone, and all references are gone, too.
        // Finally, release all memory, unless someone is holding a lock on the memory
        if (*lptr == 0) {
            // printf("Free refcounter\n");
            // The owning pointer is zero (no freeze) and now all remaining references have been removed.
            // printf("DECREF FREE %lx\n", (long)iptr);
            free(lptr);
        }
    }
}

void fyr_decref_arr(addr_t ptr, fyr_dtr_arr_t dtr) {
    if (ptr == NULL) {
        return;
    }

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

void fyr_lock(addr_t ptr) {
    if (ptr == NULL || (*(((int_t*)ptr) - 1) <= 0 && *(((int_t*)ptr) - 2) == 0)) {
        exit(EXIT_FAILURE);
    }
    int_t* lptr = ((int_t*)ptr) - 2;
    (*lptr)++;
}

void fyr_unlock(addr_t ptr, fyr_dtr_t dtr) {
    int_t* lptr = ((int_t*)ptr) - 2;
    int_t* iptr = ((int_t*)ptr) - 1;
    if (--(*lptr) == 0 && *iptr <= 0) {
        if (*iptr == INT_MIN || *iptr == 0) {        
            if (dtr) dtr(ptr);
            free(lptr);
        } else {
            if (dtr) dtr(ptr);
            void* ignore = realloc(lptr, 2 * sizeof(int_t));
            assert(ignore == lptr);
        }
    }
}

int_t fyr_len_arr(addr_t ptr) {
    if (ptr == 0) {
        return 0;
    }
    return *(((int_t*)ptr)-1);
}

int_t fyr_len_str(addr_t ptr) {
    if (ptr == 0) {
        return 0;
    }
    // -1, because the trailing 0 does not count
    return (*(((int_t*)ptr)-1)) - 1;
}

int_t fyr_min(int_t a, int_t b) {
    if (a < b) {
        return a;
    }
    return b;
}

int_t fyr_max(int_t a, int_t b) {
    if (a > b) {
        return a;
    }
    return b;
}

addr_t fyr_arr_to_str(addr_t array_ptr, addr_t data_ptr, int_t len) {
    if (array_ptr == NULL) {
        return NULL;
    }
    if (array_ptr != data_ptr) {
        memmove(array_ptr, data_ptr, len);
    }
    int *lenptr = ((int_t*)array_ptr)-1;
    if (len >= *lenptr || ((char*)array_ptr)[len] != 0) {
        exit(EXIT_FAILURE);
    }
    *lenptr = len;
    return array_ptr;
}
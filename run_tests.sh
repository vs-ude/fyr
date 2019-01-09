#!/bin/bash

####
# This is a simple testing script. It assumes that an exit code of 0 implies successful compilation
# or execution. It also does not output the errors to reduce clutter.
# At the end a summary of the tests is given. If a task fails, please execute it manually to find
# the issue.
####

# --------- define the files that should be compiled/run ---------------------
COMPILE_FILES=(
    "src/collections/tree"
    "src/collections/list"
    "src/strconv"
    "src/examples/mandelbrot"
)

RUN_FILES=(
    "list"
    "tree"
    "mandelbrot" # this takes a second...
)

# --------- setup the required variables -------------------------------------
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

FYRBASE="$DIR"

ARCH=`bin/fyrarch`

COMPILE_ERRORS=""
RUN_ERRORS=""
EXIT=0

# --------- compile/run the files silently -----------------------------------
for file in "${COMPILE_FILES[@]}"; do
    printf "%s: Compiling %s...\n" `date +%F_%T` $file
    $DIR/bin/fyrc -n $file >/dev/null 2>&1
    if [ $? -ne 0 ]; then
        COMPILE_ERRORS="$COMPILE_ERRORS $file"
    fi
done

for file in "${RUN_FILES[@]}"; do
    printf "%s: Running %s...\n" `date +%F_%T` $file
    eval "$DIR/bin/$ARCH/$file" >/dev/null 2>&1
    if [ $? -ne 0 ]; then
        RUN_ERRORS="$RUN_ERRORS $file"
    fi
done

# --------- output a summary -------------------------------------------------
printf "\n"

if [ -n "$COMPILE_ERRORS" ]; then
    printf "%s did not compile successfully\n" $COMPILE_ERRORS
    EXIT=1
fi

if [ -n "$RUN_ERRORS" ]; then
    printf "%s did not run successfully\n" $RUN_ERRORS
    EXIT=1
fi

if [ $EXIT -eq 0 ]; then
    printf "All tests completed successfully.\n"
fi

exit $EXIT

import . {
    func logString(string)
    func logFloat(double)
    func logNumber(uint)
} from "imports"

import "fyr/math"

// This is the square of the limit that pixels will need to exceed in order to
// escape from the Mandelbrot set.
const LIMIT_SQUARED double = 4.0

// This controls the maximum amount of iterations that are done for each pixel.
const MAXIMUM_ITERATIONS int = 50

var image_Width_And_Height int
var initial_r_array [16000]double
var initial_i_array [16000]double
var initial_r #double
var initial_i #double
var pixels_array [16000 * 16000 / 8]byte
var pixels #byte

func calc() {
    // pixel_Group_r and pixel_Group_i will store real and imaginary
    // values for each pixel in the current pixel group as we perform
    // iterations. Set their initial values here.
    var pixel_Group_r0 double
    var pixel_Group_i0 double
    var pixel_Group_r1 double
    var pixel_Group_i1 double
    var pixel_Group_r2 double
    var pixel_Group_i2 double
    var pixel_Group_r3 double
    var pixel_Group_i3 double
    var pixel_Group_r4 double
    var pixel_Group_i4 double
    var pixel_Group_r5 double
    var pixel_Group_i5 double
    var pixel_Group_r6 double
    var pixel_Group_i6 double
    var pixel_Group_r7 double
    var pixel_Group_i7 double

   for (var y = 0; y < 16000; y++) {
      
      var prefetched_Initial_i = initial_i[y]
      for (var x_Major = 0; x_Major < 16000; x_Major += 8) {
        
        pixel_Group_r0 = initial_r[x_Major]
        pixel_Group_i0 = prefetched_Initial_i
        pixel_Group_r1 = initial_r[x_Major + 1]
        pixel_Group_i1 = prefetched_Initial_i
        pixel_Group_r2 = initial_r[x_Major + 2]
        pixel_Group_i2 = prefetched_Initial_i
        pixel_Group_r3 = initial_r[x_Major + 3]
        pixel_Group_i3 = prefetched_Initial_i
        pixel_Group_r4 = initial_r[x_Major + 4]
        pixel_Group_i4 = prefetched_Initial_i
        pixel_Group_r5 = initial_r[x_Major + 5]
        pixel_Group_i5 = prefetched_Initial_i
        pixel_Group_r6 = initial_r[x_Major + 6]
        pixel_Group_i6 = prefetched_Initial_i
        pixel_Group_r7 = initial_r[x_Major + 7]
        pixel_Group_i7 = prefetched_Initial_i

         // Assume all pixels are in the Mandelbrot set initially.
         var eight_Pixels byte = 0xff
         
         for (var iteration = 50; eight_Pixels != 0 && iteration != 0; iteration--) {
            var current_Pixel_Bitmask byte = 0x80

            pixel_Group_r0 = pixel_Group_r0*pixel_Group_r0 - pixel_Group_i0*pixel_Group_i0 + initial_r[x_Major+0]
            pixel_Group_i0 = 2.0 * pixel_Group_r0 * pixel_Group_i0 + prefetched_Initial_i
            if (pixel_Group_r0*pixel_Group_r0*pixel_Group_r0*pixel_Group_r0 + pixel_Group_i0*pixel_Group_i0 > 4.0) {
                eight_Pixels &= ^current_Pixel_Bitmask
            }
            current_Pixel_Bitmask >>= 1

            pixel_Group_r1 = pixel_Group_r1*pixel_Group_r1 - pixel_Group_i1*pixel_Group_i1 + initial_r[x_Major+1]
            pixel_Group_i1 = 2.0 * pixel_Group_r1 * pixel_Group_i1 + prefetched_Initial_i
            if (pixel_Group_r1*pixel_Group_r1*pixel_Group_r1*pixel_Group_r1 + pixel_Group_i1*pixel_Group_i1 > 4.0) {
                eight_Pixels &= ^current_Pixel_Bitmask
            }
            current_Pixel_Bitmask >>= 1

            pixel_Group_r2 = pixel_Group_r2*pixel_Group_r2 - pixel_Group_i2*pixel_Group_i2 + initial_r[x_Major+2]
            pixel_Group_i2 = 2.0 * pixel_Group_r2 * pixel_Group_i2 + prefetched_Initial_i
            if (pixel_Group_r2*pixel_Group_r2*pixel_Group_r2*pixel_Group_r2 + pixel_Group_i2*pixel_Group_i2 > 4.0) {
                eight_Pixels &= ^current_Pixel_Bitmask
            }
            current_Pixel_Bitmask >>= 1

            pixel_Group_r3 = pixel_Group_r3*pixel_Group_r3 - pixel_Group_i3*pixel_Group_i3 + initial_r[x_Major+3]
            pixel_Group_i3 = 2.0 * pixel_Group_r3 * pixel_Group_i3 + prefetched_Initial_i
            if (pixel_Group_r3*pixel_Group_r3*pixel_Group_r3*pixel_Group_r3 + pixel_Group_i3*pixel_Group_i3 > 4.0) {
                eight_Pixels &= ^current_Pixel_Bitmask
            }
            current_Pixel_Bitmask >>= 1

            pixel_Group_r4 = pixel_Group_r4*pixel_Group_r4 - pixel_Group_i4*pixel_Group_i4 + initial_r[x_Major+4]
            pixel_Group_i4 = 2.0 * pixel_Group_r4 * pixel_Group_i4 + prefetched_Initial_i
            if (pixel_Group_r4*pixel_Group_r4*pixel_Group_r4*pixel_Group_r4 + pixel_Group_i4*pixel_Group_i4 > 4.0) {
                eight_Pixels &= ^current_Pixel_Bitmask
            }
            current_Pixel_Bitmask >>= 1

            pixel_Group_r5 = pixel_Group_r5*pixel_Group_r5 - pixel_Group_i5*pixel_Group_i5 + initial_r[x_Major+5]
            pixel_Group_i5 = 2.0 * pixel_Group_r5 * pixel_Group_i5 + prefetched_Initial_i
            if (pixel_Group_r5*pixel_Group_r5*pixel_Group_r5*pixel_Group_r5 + pixel_Group_i5*pixel_Group_i5 > 4.0) {
                eight_Pixels &= ^current_Pixel_Bitmask
            }
            current_Pixel_Bitmask >>= 1

            pixel_Group_r6 = pixel_Group_r6*pixel_Group_r6 - pixel_Group_i6*pixel_Group_i6 + initial_r[x_Major+6]
            pixel_Group_i6 = 2.0 * pixel_Group_r6 * pixel_Group_i6 + prefetched_Initial_i
            if (pixel_Group_r6*pixel_Group_r6*pixel_Group_r6*pixel_Group_r6 + pixel_Group_i6*pixel_Group_i6 > 4.0) {
                eight_Pixels &= ^current_Pixel_Bitmask
            }
            current_Pixel_Bitmask >>= 1

            pixel_Group_r7 = pixel_Group_r7*pixel_Group_r7 - pixel_Group_i7*pixel_Group_i7 + initial_r[x_Major+7]
            pixel_Group_i7 = 2.0 * pixel_Group_r7 * pixel_Group_i7 + prefetched_Initial_i
            if (pixel_Group_r7*pixel_Group_r7*pixel_Group_r7*pixel_Group_r7 + pixel_Group_i7*pixel_Group_i7 > 4.0) {
                eight_Pixels &= ^current_Pixel_Bitmask
            }
            current_Pixel_Bitmask >>= 1
         }

         pixels[y * image_Width_And_Height / 8 + x_Major / 8] = eight_Pixels
         // pixels[y * image_Width_And_Height / 8 + x_Major / 8] = 0x55
      }
   }
}

export func main() *byte {
   // Ensure image_Width_And_Height are multiples of 8.
   image_Width_And_Height = 16000
   // The image will be black and white with one bit for each pixel. Bits with
   // a value of zero are white pixels which are the ones that "escape" from
   // the Mandelbrot set. We'll be working on one line at a time and each line
   // will be made up of pixel groups that are eight pixels in size so each
   // pixel group will be one byte. This allows for some more optimizations to
   // be done.
//   pixels = make([]byte, image_Width_And_Height*image_Width_And_Height/8)
    pixels = &pixels_array[0]

   // Precompute the initial real and imaginary values for each x and y
   // coordinate in the image.
//   initial_r = make([]float64, image_Width_And_Height)
//   initial_i = make([]float64, image_Width_And_Height)
    initial_r = &initial_r_array[0]
    initial_i = &initial_i_array[0]

   for (var xy = 0; xy < image_Width_And_Height; xy++) {
      initial_r[xy] = 2.0 * <double>xy / <double>image_Width_And_Height - 1.5
      initial_i[xy] = 2.0 * <double>xy / <double>image_Width_And_Height - 1.0
//      logFloat(initial_i[xy])
   }

    calc()

    return &pixels[0]
}

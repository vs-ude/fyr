
// This is the square of the limit that pixels will need to exceed in order to
// escape from the Mandelbrot set.
const LIMIT_SQUARED = 4.0

// This controls the maximum amount of iterations that are done for each pixel.
const MAXIMUM_ITERATIONS = 50

var image_Width_And_Height;
var initial_r = [];
var initial_i = [];
var pixels = [];

function calc() {
   for (var y = 0; y < image_Width_And_Height; y++) {
      
      var prefetched_Initial_i = initial_i[y]
      for (var x_Major = 0; x_Major < image_Width_And_Height; x_Major += 8) {
        
         // pixel_Group_r and pixel_Group_i will store real and imaginary
         // values for each pixel in the current pixel group as we perform
         // iterations. Set their initial values here.
         var pixel_Group_r = [];
         var pixel_Group_i = [];
         for (var x_Minor = 0; x_Minor < 8; x_Minor++) {
            pixel_Group_r[x_Minor] = initial_r[x_Major + x_Minor]
            pixel_Group_i[x_Minor] = prefetched_Initial_i
         }

         // Assume all pixels are in the Mandelbrot set initially.
         var eight_Pixels = 0xff
         
         for (var iteration = MAXIMUM_ITERATIONS; eight_Pixels != 0 && iteration != 0; iteration--) {
            var current_Pixel_Bitmask = 0x80
            for (var x_Minor = 0; x_Minor < 8; x_Minor++) {
               var r = pixel_Group_r[x_Minor]
               var i = pixel_Group_i[x_Minor]

               pixel_Group_r[x_Minor] = r*r - i*i + initial_r[x_Major+x_Minor]
               pixel_Group_i[x_Minor] = 2.0 * r * i + prefetched_Initial_i

               // Clear the bit for the pixel if it escapes from the
               // Mandelbrot set.
               if (r*r + i*i > LIMIT_SQUARED) {
                  eight_Pixels &= ~current_Pixel_Bitmask
               }

               current_Pixel_Bitmask >>= 1
            }
         }

         pixels[y * image_Width_And_Height / 8 + x_Major / 8] = eight_Pixels
         // pixels[y * image_Width_And_Height / 8 + x_Major / 8] = 0x55
      }
   }
}

function runMandelbrot() {
   // Ensure image_Width_And_Height are multiples of 8.
   image_Width_And_Height = 16000
   // The image will be black and white with one bit for each pixel. Bits with
   // a value of zero are white pixels which are the ones that "escape" from
   // the Mandelbrot set. We'll be working on one line at a time and each line
   // will be made up of pixel groups that are eight pixels in size so each
   // pixel group will be one byte. This allows for some more optimizations to
   // be done.
//   pixels = make([]byte, image_Width_And_Height*image_Width_And_Height/8)

   // Precompute the initial real and imaginary values for each x and y
   // coordinate in the image.
//   initial_r = make([]float64, image_Width_And_Height)
//   initial_i = make([]float64, image_Width_And_Height)

   for (var xy = 0; xy < image_Width_And_Height; xy++) {
      initial_r[xy] = 2.0 * xy / image_Width_And_Height - 1.5
      initial_i[xy] = 2.0 * xy / image_Width_And_Height - 1.0
//      logFloat(initial_i[xy])
   }

    calc();
}
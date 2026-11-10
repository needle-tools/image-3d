// MIT. Minimal fixed-purpose API around the Apache-2.0 Basis Universal transcoder.
#include "basisu_transcoder.h"
#include <cstdlib>
struct Capture {
 basist::ktx2_transcoder header;
 basist::basisu_lowlevel_xuastc_ldr_transcoder decoder;
 const uint8_t* bytes;
 unsigned length,offset,size;
};
extern "C" {
void i3d_init(){basist::basisu_transcoder_init();}
void* i3d_open(const void* input,unsigned length){
 auto* image=new Capture;image->bytes=static_cast<const uint8_t*>(input);image->length=length;
 auto& p=image->header;
 if(!p.init(input,length)||!p.is_xuastc_ldr()||!p.get_width()||!p.get_height()||uint64_t(p.get_width())*p.get_height()>16777216||p.get_levels()!=1||p.get_faces()!=1||p.get_layers()>1){delete image;return nullptr;}
 const auto& h=p.get_header();const uint64_t sgd=h.m_sgd_byte_offset.get_uint64();
 const uint64_t descriptorSize=h.m_sgd_byte_length.get_uint64();
 if((descriptorSize!=sizeof(basist::ktx2_slice_offset_len_desc_orig)&&descriptorSize!=sizeof(basist::ktx2_slice_offset_len_desc_std))||sgd>length||length-sgd<descriptorSize){delete image;return nullptr;}
 const auto* slice=reinterpret_cast<const basist::ktx2_slice_offset_len_desc_orig*>(image->bytes+sgd);
 const uint64_t offset=p.get_level_index()[0].m_byte_offset.get_uint64()+unsigned(slice->m_slice_byte_offset);
 const unsigned size=slice->m_slice_byte_length;
 if(!size||offset>length||size>length-offset){delete image;return nullptr;}
 image->offset=unsigned(offset);image->size=size;return image;
}
unsigned i3d_info(void* handle,unsigned field){
 auto& image=static_cast<Capture*>(handle)->header;
 switch(field){case 0:return image.get_width();case 1:return image.get_height();case 2:return image.get_block_width();case 3:return image.get_block_height();default:return 0;}
}
unsigned i3d_size(void* handle,unsigned format){
 auto& image=static_cast<Capture*>(handle)->header;
 return basist::basis_compute_transcoded_image_size_in_bytes(static_cast<basist::transcoder_texture_format>(format),image.get_width(),image.get_height());
}
int i3d_decode(void* handle,void* output,unsigned length,unsigned format){
 auto& image=*static_cast<Capture*>(handle);auto& p=image.header;auto fmt=static_cast<basist::transcoder_texture_format>(format);
 const unsigned bytes=basist::basis_get_bytes_per_block_or_pixel(fmt),bw=p.get_block_width(),bh=p.get_block_height();
 // Calling the container-independent XUASTC path avoids linking decoders for
 // unrelated KTX2 formats. Header validation remains Basis Universal's parser.
 return bytes&&image.decoder.transcode_image(p.get_basis_tex_format(),true,fmt,output,length/bytes,image.bytes,image.length,(p.get_width()+bw-1)/bw,(p.get_height()+bh-1)/bh,p.get_width(),p.get_height(),0,image.offset,image.size,0,p.get_has_alpha(),false);
}
void i3d_close(void* handle){delete static_cast<Capture*>(handle);}
}

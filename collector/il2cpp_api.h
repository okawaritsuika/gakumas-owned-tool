#ifndef GAKUMAS_INVENTORY_IL2CPP_API_H
#define GAKUMAS_INVENTORY_IL2CPP_API_H

#include <stddef.h>
#include <stdint.h>

/* Read-only runtime exports. No managed method invocation or GC API is used. */
#define GAKUMAS_IL2CPP_APIS(X) \
    X(domain_get, void *, (void)) \
    X(thread_attach, void *, (void *domain)) \
    X(thread_detach, void, (void *thread)) \
    X(domain_get_assemblies, const void **, (void *domain, size_t *count)) \
    X(assembly_get_image, void *, (const void *assembly)) \
    X(image_get_name, const char *, (const void *image)) \
    X(class_from_name, void *, (const void *image, const char *namespaze, const char *name)) \
    X(class_from_type, void *, (const void *type)) \
    X(class_get_parent, void *, (const void *klass)) \
    X(class_get_fields, void *, (const void *klass, void **iterator)) \
    X(class_get_name, const char *, (const void *klass)) \
    X(class_get_namespace, const char *, (const void *klass)) \
    X(class_get_static_field_data, void *, (const void *klass)) \
    X(class_is_inited, uint8_t, (const void *klass)) \
    X(class_is_enum, uint8_t, (const void *klass)) \
    X(class_enum_basetype, void *, (const void *klass)) \
    X(class_get_element_class, void *, (const void *klass)) \
    X(field_get_name, const char *, (const void *field)) \
    X(field_get_offset, size_t, (const void *field)) \
    X(field_get_type, void *, (const void *field)) \
    X(field_get_flags, int32_t, (const void *field)) \
    X(type_get_type, int32_t, (const void *type)) \
    X(object_header_size, size_t, (void)) \
    X(array_object_header_size, size_t, (void)) \
    X(offset_of_array_length_in_array_object_header, size_t, (void)) \
    X(array_element_size, int32_t, (const void *array_class))

#define GAKUMAS_API_MEMBER(name, result, args) result (*name) args;
typedef struct Il2CppApi {
    GAKUMAS_IL2CPP_APIS(GAKUMAS_API_MEMBER)
} Il2CppApi;
#undef GAKUMAS_API_MEMBER

enum {
    TYPE_BOOLEAN = 0x02, TYPE_I1 = 0x04, TYPE_U1 = 0x05,
    TYPE_I2 = 0x06, TYPE_U2 = 0x07, TYPE_I4 = 0x08, TYPE_U4 = 0x09,
    TYPE_I8 = 0x0a, TYPE_U8 = 0x0b, TYPE_STRING = 0x0e,
    TYPE_VALUETYPE = 0x11, TYPE_CLASS = 0x12,
    TYPE_GENERICINST = 0x15, TYPE_OBJECT = 0x1c, TYPE_SZARRAY = 0x1d,
    FIELD_STATIC = 0x10, FIELD_LITERAL = 0x40
};

#endif

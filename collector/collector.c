#define WIN32_LEAN_AND_MEAN
#define _CRT_SECURE_NO_WARNINGS
#include <windows.h>
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include "il2cpp_api.h"

/* Four inventory collections plus optional allowlisted growth-panel state. */
#define PATH_CAP 32768
#define MAX_RECORDS 20000
#define MAX_NESTED 512
#define MAX_STRING 4096
#define MAX_JSON (64u * 1024u * 1024u)
#define FIELD_CACHE_SIZE 512

typedef struct Json {
    char *data;
    size_t len, cap;
    int failed;
} Json;

typedef struct Field {
    int found;
    char name[128];
    int32_t flags, kind;
    size_t offset;
    void *type;
    void *owner;
} Field;

typedef struct FieldCache {
    void *klass;
    char name[128];
    Field field;
} FieldCache;

typedef struct CollectionResult {
    const char *name;
    const char *record_type;
    const char *backing_field;
    const char *status;
    char message[256];
    int expected, exported;
    Json rows;
} CollectionResult;

static HMODULE g_module;
static volatile LONG g_stop;
static Il2CppApi api;
static size_t object_header, array_header, array_length_offset;
static FieldCache field_cache[FIELD_CACHE_SIZE];
static size_t field_cache_count;
static wchar_t output_path[PATH_CAP], status_path[PATH_CAP], log_path[PATH_CAP], control_path[PATH_CAP], cancel_path[PATH_CAP];
static DWORD interval_ms = 10000;
static int sampling_enabled;
static const char *last_error = "unknown_error";
static char field_error[256];
static void log_stage(const char *state, const char *stage, const char *message);
static void diagnose_class(void *klass, const char *stage);
static int collection_requested(void);

static int fail(const char *message) {
    last_error = message;
    return 0;
}

static int fail_field(const char *message, Field f) {
    snprintf(field_error, sizeof(field_error), "%s:%s", message, f.name);
    return fail(field_error);
}

static int read_self(const void *address, void *destination, size_t bytes) {
    uintptr_t p = (uintptr_t)address;
    if (!p || p < 65536 || bytes > MAX_JSON || p + bytes < p)
        return fail("invalid_memory_range");
#ifdef _MSC_VER
    __try { memcpy(destination, address, bytes); }
    __except (EXCEPTION_EXECUTE_HANDLER) { return fail("memory_read_failed"); }
#else
    SIZE_T got = 0;
    if (!ReadProcessMemory(GetCurrentProcess(), address, destination, bytes, &got) || got != bytes)
        return fail("memory_read_failed");
#endif
    return 1;
}

static int read_pointer(const void *at, void **value) {
    return read_self(at, value, sizeof(*value));
}

static void *add_pointer(const void *p, size_t n) {
    return (void *)((uintptr_t)p + n);
}

static int copy_c_string(const char *source, char *out, size_t capacity) {
    size_t i;
    if (!source || !capacity) return 0;
    for (i = 0; i + 1 < capacity; ++i) {
        if (!read_self(source + i, out + i, 1)) return 0;
        if (!out[i]) return 1;
    }
    out[capacity - 1] = 0;
    return fail("runtime_name_too_long");
}

static int class_named(void *klass, const char *expected) {
    char name[160];
    return klass && copy_c_string(api.class_get_name(klass), name, sizeof(name)) &&
        strcmp(name, expected) == 0;
}

static int class_exact(void *klass, const char *namespaze, const char *expected) {
    char actual[160];
    return class_named(klass, expected) &&
        copy_c_string(api.class_get_namespace(klass), actual, sizeof(actual)) &&
        strcmp(actual, namespaze) == 0;
}

static int fail_class(const char *message, void *klass) {
    char name[128] = "unknown", namespaze[128] = "";
    diagnose_class(klass, message);
    if (klass) {
        copy_c_string(api.class_get_name(klass), name, sizeof(name));
        copy_c_string(api.class_get_namespace(klass), namespaze, sizeof(namespaze));
    }
    snprintf(field_error, sizeof(field_error), "%s:%s%s%s", message,
             namespaze, namespaze[0] ? "." : "", name);
    return fail(field_error);
}

static void *object_class(void *object) {
    void *klass = NULL;
    if (!object || !read_pointer(object, &klass) || !klass) return NULL;
    return klass;
}

static void json_init(Json *j) {
    memset(j, 0, sizeof(*j));
    j->cap = 1024;
    j->data = (char *)malloc(j->cap);
    if (!j->data) { j->failed = 1; fail("out_of_memory"); }
    else j->data[0] = 0;
}

static void json_free(Json *j) {
    free(j->data);
    memset(j, 0, sizeof(*j));
}

static int json_bytes(Json *j, const char *text, size_t count) {
    size_t needed, capacity;
    char *replacement;
    if (j->failed) return 0;
    if (count >= MAX_JSON || j->len >= MAX_JSON - count) {
        j->failed = 1;
        return fail("snapshot_too_large");
    }
    needed = j->len + count + 1;
    if (needed > j->cap) {
        capacity = j->cap;
        while (capacity < needed) capacity *= 2;
        replacement = (char *)realloc(j->data, capacity);
        if (!replacement) {
            j->failed = 1;
            return fail("out_of_memory");
        }
        j->data = replacement;
        j->cap = capacity;
    }
    memcpy(j->data + j->len, text, count);
    j->len += count;
    j->data[j->len] = 0;
    return 1;
}

static int json_text(Json *j, const char *text) {
    return json_bytes(j, text, strlen(text));
}

static int json_string(Json *j, const char *text) {
    const unsigned char *p = (const unsigned char *)text;
    char escape[7];
    if (!json_text(j, "\"")) return 0;
    for (; *p; ++p) {
        if (*p == '"' || *p == '\\') {
            escape[0] = '\\'; escape[1] = (char)*p;
            if (!json_bytes(j, escape, 2)) return 0;
        } else if (*p < 32) {
            snprintf(escape, sizeof(escape), "\\u%04x", (unsigned)*p);
            if (!json_text(j, escape)) return 0;
        } else if (!json_bytes(j, (const char *)p, 1)) return 0;
    }
    return json_text(j, "\"");
}

static int json_number(Json *j, int64_t value) {
    char text[32];
    snprintf(text, sizeof(text), "%lld", (long long)value);
    return json_text(j, text);
}

static int json_unsigned_string(Json *j, uint64_t value) {
    char text[32];
    snprintf(text, sizeof(text), "%llu", (unsigned long long)value);
    return json_string(j, text);
}

static int json_key(Json *j, const char *name, int *first) {
    if (!*first && !json_text(j, ",")) return 0;
    *first = 0;
    return json_string(j, name) && json_text(j, ":");
}

static int json_managed_string(Json *j, void *object) {
    int32_t length;
    wchar_t *wide;
    char *utf8;
    int needed, ok;
    if (!object) return json_text(j, "null");
    if (!read_self(add_pointer(object, object_header), &length, sizeof(length))) return 0;
    if (length < 0 || length > MAX_STRING) return fail("string_length_out_of_bounds");
    if (!length) return json_string(j, "");
    wide = (wchar_t *)malloc(((size_t)length + 1) * sizeof(wchar_t));
    if (!wide) return fail("out_of_memory");
    if (!read_self(add_pointer(object, object_header + sizeof(int32_t)), wide,
                   (size_t)length * sizeof(wchar_t))) {
        free(wide); return 0;
    }
    /* Embedded NUL cannot be a game ID; fail rather than silently truncate it. */
    if (wmemchr(wide, L'\0', (size_t)length)) {
        free(wide); return fail("embedded_nul_in_string");
    }
    needed = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, wide, length, NULL, 0, NULL, NULL);
    if (!needed) { free(wide); return fail("invalid_utf16"); }
    utf8 = (char *)malloc((size_t)needed + 1);
    if (!utf8) { free(wide); return fail("out_of_memory"); }
    ok = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, wide, length,
                             utf8, needed, NULL, NULL) == needed;
    utf8[needed] = 0;
    if (ok) ok = json_string(j, utf8);
    free(utf8); free(wide);
    return ok;
}

static Field find_field(void *klass, const char *name) {
    size_t i;
    int depth;
    void *current = klass;
    Field result;
    memset(&result, 0, sizeof(result));
    if (strlen(name) < sizeof(result.name)) strcpy(result.name, name);
    for (i = 0; i < field_cache_count; ++i)
        if (field_cache[i].klass == klass && strcmp(field_cache[i].name, name) == 0)
            return field_cache[i].field;
    for (depth = 0; current && depth < 24; ++depth) {
        void *iterator = NULL;
        void *field;
        int count = 0;
        while ((field = api.class_get_fields(current, &iterator)) != NULL) {
            char actual[128];
            if (++count > 4096) { fail("field_table_out_of_bounds"); return result; }
            if (!copy_c_string(api.field_get_name(field), actual, sizeof(actual))) return result;
            if (strcmp(actual, name) != 0) continue;
            result.found = 1;
            result.offset = api.field_get_offset(field);
            result.flags = api.field_get_flags(field);
            result.type = api.field_get_type(field);
            result.kind = api.type_get_type(result.type);
            result.owner = current;
            goto done;
        }
        current = api.class_get_parent(current);
    }
done:
    /* Cache only resolved fields; a class may not have its metadata set up yet. */
    if (result.found && strlen(name) < sizeof(field_cache[0].name) && field_cache_count < FIELD_CACHE_SIZE) {
        FieldCache *cached = &field_cache[field_cache_count++];
        cached->klass = klass;
        strcpy(cached->name, name);
        cached->field = result;
    }
    return result;
}

static Field field_alias(void *klass, const char *first, const char *second) {
    Field f = find_field(klass, first);
    return f.found || !second ? f : find_field(klass, second);
}

/* Only runtime metadata names, once per class; never object values or addresses. */
static void diagnose_class(void *klass, const char *stage) {
    static void *seen[16];
    static size_t seen_count;
    const char *saved_error = last_error;
    void *current = klass;
    size_t i;
    int depth;
    if (!klass || seen_count == sizeof(seen) / sizeof(seen[0])) return;
    for (i = 0; i < seen_count; ++i) if (seen[i] == klass) return;
    seen[seen_count++] = klass;
    for (depth = 0; current && depth < 3; ++depth) {
        char name[128], namespaze[128], message[280];
        void *iterator = NULL, *field;
        int count = 0;
        if (copy_c_string(api.class_get_name(current), name, sizeof(name)) &&
            copy_c_string(api.class_get_namespace(current), namespaze, sizeof(namespaze))) {
            snprintf(message, sizeof(message), "class=%s%s%s", namespaze,
                     namespaze[0] ? "." : "", name);
            log_stage("diagnostic", stage, message);
        }
        while (count++ < 32 && (field = api.class_get_fields(current, &iterator)) != NULL) {
            if (copy_c_string(api.field_get_name(field), name, sizeof(name))) {
                snprintf(message, sizeof(message), "field=%s", name);
                log_stage("diagnostic", stage, message);
            }
        }
        current = api.class_get_parent(current);
    }
    last_error = saved_error;
}

static Field proto_field(void *object, const char *name) {
    char backing[128];
    Field f;
    void *klass = object_class(object);
    memset(&f, 0, sizeof(f));
    if (!klass || strlen(name) + 2 > sizeof(backing)) return f;
    snprintf(backing, sizeof(backing), "%s_", name);
    f = field_alias(klass, backing, name);
    if (!f.found) diagnose_class(klass, "missing_proto_field");
    return f;
}

static int field_address(void *object, Field f, void **address) {
    if (!f.found) return fail_field("required_field_missing", f);
    if ((f.flags & FIELD_STATIC) || f.offset < object_header || f.offset > 1024 * 1024)
        return fail_field("invalid_instance_field", f);
    *address = add_pointer(object, f.offset);
    return 1;
}

static int reference_kind(int32_t kind) {
    return kind == TYPE_CLASS || kind == TYPE_OBJECT || kind == TYPE_GENERICINST ||
        kind == TYPE_STRING || kind == TYPE_SZARRAY;
}

static int read_object_field(void *object, Field f, void **value) {
    void *address;
    if (!f.found) return fail_field("required_field_missing", f);
    if (!reference_kind(f.kind)) return fail_field("unexpected_reference_field_type", f);
    return field_address(object, f, &address) && read_pointer(address, value);
}

static int underlying_kind(Field f) {
    void *klass, *base;
    if (f.kind != TYPE_VALUETYPE) return f.kind;
    klass = api.class_from_type(f.type);
    if (!klass || !api.class_is_enum(klass)) return -1;
    base = api.class_enum_basetype(klass);
    return base ? api.type_get_type(base) : -1;
}

static int read_integer_at(const void *address, int kind, int64_t *value, uint64_t *unsigned_value) {
    union { int8_t i1; uint8_t u1; int16_t i2; uint16_t u2; int32_t i4; uint32_t u4; int64_t i8; uint64_t u8; } n;
    *unsigned_value = 0;
    switch (kind) {
        case TYPE_BOOLEAN: case TYPE_U1:
            if (!read_self(address, &n.u1, 1)) return 0; *value = n.u1; break;
        case TYPE_I1:
            if (!read_self(address, &n.i1, 1)) return 0; *value = n.i1; break;
        case TYPE_I2:
            if (!read_self(address, &n.i2, 2)) return 0; *value = n.i2; break;
        case TYPE_U2:
            if (!read_self(address, &n.u2, 2)) return 0; *value = n.u2; break;
        case TYPE_I4:
            if (!read_self(address, &n.i4, 4)) return 0; *value = n.i4; break;
        case TYPE_U4:
            if (!read_self(address, &n.u4, 4)) return 0; *value = n.u4; break;
        case TYPE_I8:
            if (!read_self(address, &n.i8, 8)) return 0; *value = n.i8; break;
        case TYPE_U8:
            if (!read_self(address, &n.u8, 8)) return 0; *unsigned_value = n.u8; *value = 0; break;
        default: return fail("unsupported_scalar_type");
    }
    return 1;
}

static int read_i32_field(void *object, Field f, int32_t *value) {
    void *address;
    if (!f.found) return fail_field("required_field_missing", f);
    if (f.kind != TYPE_I4) return fail_field("unexpected_count_type", f);
    return field_address(object, f, &address) && read_self(address, value, sizeof(*value));
}

static int write_scalar(Json *j, void *object, const char *name, int require_string) {
    Field f = proto_field(object, name);
    void *address, *reference;
    int kind;
    int64_t value;
    uint64_t unsigned_value;
    if (!field_address(object, f, &address)) return 0;
    if (f.kind == TYPE_STRING) {
        if (!read_pointer(address, &reference)) return 0;
        if (require_string && !reference) return fail("required_id_is_null");
        return json_managed_string(j, reference);
    }
    if (require_string) return fail_field("expected_string_id", f);
    kind = underlying_kind(f);
    if (kind < 0) return fail_field("unsupported_scalar_type", f);
    if (!read_integer_at(address, kind, &value, &unsigned_value)) return 0;
    if (kind == TYPE_BOOLEAN) return json_text(j, value ? "true" : "false");
    /* Protobuf JSON represents 64-bit scalars as strings, avoiding JS precision loss. */
    if (kind == TYPE_U8) return json_unsigned_string(j, unsigned_value);
    if (kind == TYPE_I8) {
        char text[32]; snprintf(text, sizeof(text), "%lld", (long long)value);
        return json_string(j, text);
    }
    return json_number(j, value);
}

typedef int (*ObjectWriter)(Json *, void *);

static int write_card(Json *j, void *object);
static int write_customize(Json *j, void *object);
static int write_ability(Json *j, void *object);

/* mode: 0 = reference objects, 1 = string references, 2 = int32 enum values. */
static int write_repeated(Json *j, void *repeated, int mode, ObjectWriter writer) {
    Field count_field, array_field;
    void *klass, *array, *array_after, *array_class;
    int32_t count, count_after, stride;
    size_t length = 0;
    int i;
    if (!repeated) return fail("repeated_field_not_ready");
    klass = object_class(repeated);
    if (!klass) return 0;
    count_field = field_alias(klass, "count", "_size");
    array_field = field_alias(klass, "array", "_items");
    if (!read_i32_field(repeated, count_field, &count) ||
        !read_object_field(repeated, array_field, &array)) return 0;
    if (count < 0 || count > MAX_NESTED) return fail("repeated_count_out_of_bounds");
    if (count && !array) return fail("repeated_array_not_ready");
    if (array) {
        array_class = object_class(array);
        if (!array_class || !read_self(add_pointer(array, array_length_offset), &length, sizeof(length))) return 0;
        stride = api.array_element_size(array_class);
        if (length > MAX_RECORDS || (size_t)count > length ||
            stride != (mode == 2 ? (int32_t)sizeof(int32_t) : (int32_t)sizeof(void *)))
            return fail("unsupported_repeated_array_layout");
    }
    if (!json_text(j, "[")) return 0;
    for (i = 0; i < count; ++i) {
        void *at = add_pointer(array, array_header + (size_t)i * (mode == 2 ? 4 : sizeof(void *)));
        if (i && !json_text(j, ",")) return 0;
        if (mode == 2) {
            int32_t value;
            if (!read_self(at, &value, sizeof(value)) || !json_number(j, value)) return 0;
        } else {
            void *element;
            if (!read_pointer(at, &element) || !element) return fail("null_repeated_element");
            if (mode == 1) { if (!json_managed_string(j, element)) return 0; }
            else if (!writer || !writer(j, element)) return 0;
        }
    }
    if (!json_text(j, "]") || !read_i32_field(repeated, count_field, &count_after) ||
        !read_object_field(repeated, array_field, &array_after)) return 0;
    if (count != count_after || array != array_after) return fail("repeated_changed_during_read");
    return 1;
}

static int scalar_property(Json *j, void *object, const char *name, int string_id, int *first) {
    return json_key(j, name, first) && write_scalar(j, object, name, string_id);
}

static int repeated_property(Json *j, void *object, const char *name, int mode, ObjectWriter writer, int *first) {
    void *repeated;
    Field f = proto_field(object, name);
    return json_key(j, name, first) && read_object_field(object, f, &repeated) &&
        write_repeated(j, repeated, mode, writer);
}

static int write_customize(Json *j, void *object) {
    int first = 1;
    return json_text(j, "{") && scalar_property(j, object, "id", 1, &first) &&
        scalar_property(j, object, "customizeCount", 0, &first) && json_text(j, "}");
}

static int write_ability(Json *j, void *object) {
    int first = 1;
    return json_text(j, "{") && scalar_property(j, object, "id", 1, &first) &&
        scalar_property(j, object, "level", 0, &first) && json_text(j, "}");
}

static int write_card(Json *j, void *object) {
    int first = 1;
    if (!object) return json_text(j, "null");
    return json_text(j, "{") && scalar_property(j, object, "id", 1, &first) &&
        scalar_property(j, object, "upgradeCount", 0, &first) &&
        repeated_property(j, object, "customizes", 0, write_customize, &first) && json_text(j, "}");
}

static int write_support(Json *j, void *object) {
    int first = 1;
    return json_text(j, "{") && scalar_property(j, object, "supportCardId", 1, &first) &&
        scalar_property(j, object, "level", 0, &first) &&
        scalar_property(j, object, "levelLimitRank", 0, &first) &&
        scalar_property(j, object, "stockQuantity", 0, &first) && json_text(j, "}");
}

static int write_idol(Json *j, void *object) {
    int first = 1;
    return json_text(j, "{") && scalar_property(j, object, "idolCardId", 1, &first) &&
        scalar_property(j, object, "levelLimitRank", 0, &first) &&
        scalar_property(j, object, "potentialRank", 0, &first) &&
        scalar_property(j, object, "primaStellaUpgradedTime", 0, &first) && json_text(j, "}");
}

static int write_character(Json *j, void *object) {
    int first = 1;
    return json_text(j, "{") && scalar_property(j, object, "characterId", 1, &first) &&
        scalar_property(j, object, "dearnessPoint", 0, &first) &&
        repeated_property(j, object, "trueEndProduceTypes", 2, NULL, &first) && json_text(j, "}");
}

static int write_growth_panel(Json *j, void *object) {
    int first = 1;
    Field level, enabled;
    if (!class_exact(object_class(object), "Campus.Common.Proto.Client.Transaction", "UserProduceGrowthPanel"))
        return fail_class("unexpected_growth_panel_record_type", object_class(object));
    level = proto_field(object, "level");
    enabled = proto_field(object, "enable");
    if (!level.found) return fail_field("required_field_missing", level);
    if (!enabled.found) return fail_field("required_field_missing", enabled);
    if (level.kind != TYPE_I4) return fail_field("unexpected_growth_panel_type", level);
    if (enabled.kind != TYPE_BOOLEAN) return fail_field("unexpected_growth_panel_type", enabled);
    return json_text(j, "{") && scalar_property(j, object, "produceGrowthPanelId", 1, &first) &&
        scalar_property(j, object, "level", 0, &first) &&
        scalar_property(j, object, "enable", 0, &first) && json_text(j, "}");
}

static int write_memory(Json *j, void *object) {
    int first = 1;
    void *card;
    const char *ids[] = { "userMemoryId", "produceId", "characterId", "idolCardId" };
    const char *numbers[] = { "planType", "produceCardPhaseType", "vocal", "dance", "visual", "stamina", "isPrimaStella" };
    size_t i;
    if (!json_text(j, "{")) return 0;
    for (i = 0; i < sizeof(ids)/sizeof(ids[0]); ++i)
        if (!scalar_property(j, object, ids[i], 1, &first)) return 0;
    for (i = 0; i < sizeof(numbers)/sizeof(numbers[0]); ++i)
        if (!scalar_property(j, object, numbers[i], 0, &first)) return 0;
    if (!json_key(j, "produceCard", &first) ||
        !read_object_field(object, proto_field(object, "produceCard"), &card) || !write_card(j, card)) return 0;
    return repeated_property(j, object, "abilities", 0, write_ability, &first) &&
        repeated_property(j, object, "examBattleProduceCards", 0, write_card, &first) &&
        repeated_property(j, object, "examBattleProduceItemIds", 1, NULL, &first) && json_text(j, "}");
}

static int struct_address(void *data, Field f, size_t stride, size_t width, void **address) {
    if (!f.found || (f.flags & FIELD_STATIC) || f.offset < object_header ||
        f.offset - object_header > stride || width > stride - (f.offset - object_header))
        return fail("unsupported_dictionary_entry_layout");
    *address = add_pointer(data, f.offset - object_header);
    return 1;
}

static int capture_collection(void *manager, CollectionResult *result, ObjectWriter writer) {
    void *collection, *container_root, *dictionary, *dict_class, *entries, *entries_after;
    void *array_class, *entry_class;
    struct { void *object, *child; Field field; } wrappers[2];
    int wrapper_count = 0;
    Field count_field, free_field, version_field, entries_field, hash_field, next_field, value_field;
    int32_t count, free_count, version, after_count, after_free, after_version, stride;
    size_t capacity;
    int i, active = 0;
    int old_layout;
    if (!read_object_field(manager, find_field(object_class(manager), result->backing_field), &collection) || !collection)
        return fail("owned_collection_not_ready");
    if (!read_object_field(collection, find_field(object_class(collection), "_entries"), &dictionary) || !dictionary)
        return fail("owned_dictionary_not_ready");
    container_root = dictionary;
    dict_class = object_class(dictionary);
    if (!dict_class) return 0;
    while (!class_exact(dict_class, "System.Collections.Generic", "Dictionary`2")) {
        Field inner;
        void *child;
        if (wrapper_count == 2) return fail_class("owned_wrapper_depth_exceeded", dict_class);
        if (class_exact(dict_class, "UniRx", "ReactiveDictionary`2"))
            inner = find_field(dict_class, "inner");
        else if (class_exact(dict_class, "System.Collections.ObjectModel", "ReadOnlyDictionary`2"))
            inner = find_field(dict_class, "m_dictionary");
        else return fail_class("unsupported_owned_container", dict_class);
        if (!inner.found) diagnose_class(dict_class, "missing_wrapper_field");
        if (!read_object_field(dictionary, inner, &child)) return 0;
        if (!child) return fail("owned_dictionary_not_ready");
        wrappers[wrapper_count].object = dictionary;
        wrappers[wrapper_count].child = child;
        wrappers[wrapper_count++].field = inner;
        dictionary = child;
        dict_class = object_class(dictionary);
        if (!dict_class) return 0;
    }
    count_field = field_alias(dict_class, "_count", "count");
    free_field = field_alias(dict_class, "_freeCount", "freeCount");
    version_field = field_alias(dict_class, "_version", "version");
    entries_field = field_alias(dict_class, "_entries", "entries");
    if (!count_field.found || !free_field.found || !version_field.found || !entries_field.found)
        diagnose_class(dict_class, "missing_dictionary_field");
    if (!read_i32_field(dictionary, count_field, &count) ||
        !read_i32_field(dictionary, free_field, &free_count) ||
        !read_i32_field(dictionary, version_field, &version) ||
        !read_object_field(dictionary, entries_field, &entries)) return 0;
    if (count < 0 || count > MAX_RECORDS || free_count < 0 || free_count > count)
        return fail("dictionary_count_out_of_bounds");
    result->expected = count - free_count;
    if (!json_text(&result->rows, "[")) return 0;
    if (count) {
        array_class = object_class(entries);
        if (!array_class || !read_self(add_pointer(entries, array_length_offset), &capacity, sizeof(capacity))) return 0;
        stride = api.array_element_size(array_class);
        entry_class = api.class_get_element_class(array_class);
        if ((size_t)count > capacity || capacity > MAX_RECORDS * 4u || stride < 16 || stride > 512 || !entry_class)
            return fail("dictionary_array_out_of_bounds");
        hash_field = find_field(entry_class, "hashCode");
        next_field = find_field(entry_class, "next");
        value_field = find_field(entry_class, "value");
        if (!hash_field.found || !next_field.found || !value_field.found ||
            (hash_field.kind != TYPE_I4 && hash_field.kind != TYPE_U4) ||
            next_field.kind != TYPE_I4 || !reference_kind(value_field.kind))
            return fail("unsupported_dictionary_entry_fields");
        old_layout = hash_field.kind == TYPE_I4;
        for (i = 0; i < count; ++i) {
            void *entry = add_pointer(entries, array_header + (size_t)i * (size_t)stride);
            void *address, *record, *record_class;
            int32_t marker;
            if (!struct_address(entry, old_layout ? hash_field : next_field, (size_t)stride, sizeof(marker), &address) ||
                !read_self(address, &marker, sizeof(marker))) return 0;
            if (old_layout ? marker < 0 : marker < -1) continue;
            if (!struct_address(entry, value_field, (size_t)stride, sizeof(record), &address) ||
                !read_pointer(address, &record) || !record) return fail("null_owned_record");
            record_class = object_class(record);
            if (!class_named(record_class, result->record_type))
                return fail_class("unexpected_owned_record_type", record_class);
            if (active && !json_text(&result->rows, ",")) return 0;
            if (!writer(&result->rows, record)) return 0;
            ++active;
            result->exported = active;
        }
    }
    if (active != result->expected) return fail("dictionary_active_count_mismatch");
    if (!json_text(&result->rows, "]") ||
        !read_i32_field(dictionary, count_field, &after_count) ||
        !read_i32_field(dictionary, free_field, &after_free) ||
        !read_i32_field(dictionary, version_field, &after_version) ||
        !read_object_field(dictionary, entries_field, &entries_after)) return 0;
    if (count != after_count || free_count != after_free || version != after_version || entries != entries_after)
        return fail("dictionary_changed_during_read");
    for (i = 0; i < wrapper_count; ++i) {
        void *child_after;
        if (!read_object_field(wrappers[i].object, wrappers[i].field, &child_after) ||
            child_after != wrappers[i].child) return fail("owned_wrapper_replaced_during_read");
    }
    /* The manager may replace a collection or its dictionary during account refresh. */
    {
        void *collection_after, *dictionary_after;
        if (!read_object_field(manager, find_field(object_class(manager), result->backing_field), &collection_after) ||
            collection_after != collection ||
            !read_object_field(collection, find_field(object_class(collection), "_entries"), &dictionary_after) ||
            dictionary_after != container_root) return fail("collection_replaced_during_read");
    }
    result->status = "complete";
    strcpy(result->message, "stable_collection");
    return 1;
}

static void utc_now(char *out, size_t capacity) {
    SYSTEMTIME t;
    GetSystemTime(&t);
    snprintf(out, capacity, "%04u-%02u-%02uT%02u:%02u:%02u.%03uZ",
             t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond, t.wMilliseconds);
}

static int atomic_write(const wchar_t *path, const Json *j, int require_enabled) {
    wchar_t temp[PATH_CAP];
    HANDLE file;
    DWORD written = 0;
    int ok;
    if (j->failed || !j->data || j->len > MAX_JSON) return fail("invalid_json_buffer");
    if (swprintf(temp, PATH_CAP, L"%ls.tmp.%lu", path, GetCurrentProcessId()) < 0)
        return fail("output_path_too_long");
    file = CreateFileW(temp, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return fail("output_open_failed");
    ok = WriteFile(file, j->data, (DWORD)j->len, &written, NULL) && written == j->len && FlushFileBuffers(file);
    CloseHandle(file);
    if (ok && require_enabled && !collection_requested()) {
        DeleteFileW(temp); return fail("collection_disabled_before_publish");
    }
    if (ok) ok = MoveFileExW(temp, path, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) != 0;
    if (!ok) { DeleteFileW(temp); return fail("output_write_failed"); }
    return 1;
}

static void log_stage(const char *state, const char *stage, const char *message) {
    HANDLE file;
    LARGE_INTEGER size;
    char time[40], line[384];
    DWORD written;
    int length;
    if (!log_path[0]) return;
    file = CreateFileW(log_path, FILE_APPEND_DATA | FILE_READ_ATTRIBUTES, FILE_SHARE_READ, NULL,
                       OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return;
    if (GetFileSizeEx(file, &size) && size.QuadPart > 1024 * 1024) {
        CloseHandle(file);
        file = CreateFileW(log_path, GENERIC_WRITE, FILE_SHARE_READ, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
        if (file == INVALID_HANDLE_VALUE) return;
    }
    utc_now(time, sizeof(time));
    length = snprintf(line, sizeof(line), "%s %s %s %s\r\n", time, state, stage, message);
    if (length > 0 && length < (int)sizeof(line)) WriteFile(file, line, (DWORD)length, &written, NULL);
    CloseHandle(file);
}

static void collection_status_json(Json *j, CollectionResult *results) {
    int i;
    json_text(j, "{");
    for (i = 0; i < 4; ++i) {
        if (i) json_text(j, ",");
        json_string(j, results[i].name); json_text(j, ":{\"status\":");
        json_string(j, results[i].status);
        json_text(j, ",\"expectedCount\":");
        if (results[i].expected < 0) json_text(j, "null"); else json_number(j, results[i].expected);
        json_text(j, ",\"exportedCount\":"); json_number(j, results[i].exported);
        json_text(j, ",\"message\":"); json_string(j, results[i].message);
        json_text(j, "}");
    }
    json_text(j, "}");
}

static void publish_status(const char *state, const char *stage, const char *message, CollectionResult *results) {
    Json j;
    char time[40];
    utc_now(time, sizeof(time));
    json_init(&j);
    json_text(&j, "{\"schemaVersion\":1,\"collectorVersion\":\"0.1.3\",\"source\":\"gakumas-local-collector\",\"capturedAt\":");
    json_string(&j, time);
    json_text(&j, ",\"state\":"); json_string(&j, state);
    json_text(&j, ",\"stage\":"); json_string(&j, stage);
    json_text(&j, ",\"message\":"); json_string(&j, message);
    json_text(&j, ",\"moduleVersion\":\"0.1.3\",\"controlSupported\":true,\"samplingEnabled\":");
    json_text(&j, collection_requested() ? "true" : "false");
    json_text(&j, ",\"capture\":{\"status\":"); json_string(&j, state);
    if (results) {
        json_text(&j, ",\"collections\":"); collection_status_json(&j, results);
    }
    json_text(&j, "}}");
    if (!atomic_write(status_path, &j, 0)) log_stage("error", "status_output", last_error);
    json_free(&j);
    log_stage(state, stage, message);
}

static int initialize_paths(void) {
    wchar_t module_path[PATH_CAP], directory[PATH_CAP], ini[PATH_CAP];
    wchar_t *slash;
    DWORD length;
    int seconds;
    length = GetModuleFileNameW(g_module, module_path, PATH_CAP);
    if (!length || length >= PATH_CAP) return 0;
    slash = wcsrchr(module_path, L'\\');
    if (!slash) return 0;
    *slash = 0;
    if (swprintf(directory, PATH_CAP, L"%ls\\gakumas-inventory", module_path) < 0) return 0;
    CreateDirectoryW(directory, NULL);
    if (swprintf(ini, PATH_CAP, L"%ls\\collector.ini", directory) < 0 ||
        swprintf(log_path, PATH_CAP, L"%ls\\collector.log", directory) < 0 ||
        swprintf(output_path, PATH_CAP, L"%ls\\inventory.json", directory) < 0) return 0;
    GetPrivateProfileStringW(L"collector", L"output", output_path, module_path, PATH_CAP, ini);
    if (!(module_path[0] && module_path[1] == L':' && module_path[2] == L'\\')) return 0;
    wcscpy(output_path, module_path);
    if (swprintf(status_path, PATH_CAP, L"%ls.status.json", output_path) < 0) return 0;
    slash = wcsrchr(module_path, L'\\');
    if (!slash) return 0;
    slash[1] = 0;
    if (wcslen(module_path) + 23 >= PATH_CAP) return 0;
    wcscat(module_path, L"collector-control.json");
    GetPrivateProfileStringW(L"collector", L"control", module_path, control_path, PATH_CAP, ini);
    if (!(control_path[0] && control_path[1] == L':' && control_path[2] == L'\\')) return 0;
    if (swprintf(cancel_path, PATH_CAP, L"%ls.cancel", control_path) < 0) return 0;
    seconds = (int)GetPrivateProfileIntW(L"collector", L"interval_seconds", 10, ini);
    if (seconds < 2) seconds = 2;
    if (seconds > 300) seconds = 300;
    interval_ms = (DWORD)seconds * 1000;
    return 1;
}

static void skip_json_space(const char **at) {
    while (**at == ' ' || **at == '\r' || **at == '\n' || **at == '\t') ++*at;
}

/* Deliberately accept only the three-field control contract, never a permissive
   substring match. A missing, torn, stale or unrecognized request means off. */
static int collection_requested(void) {
    char data[1024], key[32];
    const char *at;
    HANDLE file;
    LARGE_INTEGER size;
    DWORD got;
    unsigned fields = 0, bit;
    int enabled = 0, schema = 0;
    uint64_t expires = 0, value, now;
    FILETIME ft;
    ULARGE_INTEGER ticks;
    size_t length;
    /* A persistent stop request wins even if an old server renews its lease.
       Only a new, explicit collect action may remove this marker. */
    if (GetFileAttributesW(cancel_path) != INVALID_FILE_ATTRIBUTES) return 0;
    {
        DWORD cancel_error = GetLastError();
        if (cancel_error != ERROR_FILE_NOT_FOUND && cancel_error != ERROR_PATH_NOT_FOUND) return 0;
    }
    file = CreateFileW(control_path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                       NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return 0;
    if (!GetFileSizeEx(file, &size) || size.QuadPart <= 0 || size.QuadPart >= sizeof(data) ||
        !ReadFile(file, data, (DWORD)size.QuadPart, &got, NULL) || got != size.QuadPart) {
        CloseHandle(file); return 0;
    }
    CloseHandle(file);
    data[got] = 0;
    if (memchr(data, 0, got)) return 0;
    at = data;
    if (got >= 3 && memcmp(at, "\xef\xbb\xbf", 3) == 0) at += 3;
    skip_json_space(&at);
    if (*at++ != '{') return 0;
    for (;;) {
        skip_json_space(&at);
        if (*at++ != '"') return 0;
        length = 0;
        while (*at && *at != '"') {
            if (*at == '\\' || (unsigned char)*at < 32 || length >= sizeof(key) - 1) return 0;
            key[length++] = *at++;
        }
        if (*at++ != '"') return 0;
        key[length] = 0;
        bit = strcmp(key, "schemaVersion") == 0 ? 1 : strcmp(key, "enabled") == 0 ? 2 :
              strcmp(key, "expiresAtUnixMs") == 0 ? 4 : 0;
        if (!bit || (fields & bit)) return 0;
        fields |= bit;
        skip_json_space(&at);
        if (*at++ != ':') return 0;
        skip_json_space(&at);
        if (bit == 2) {
            if (strncmp(at, "true", 4) == 0) { enabled = 1; at += 4; }
            else if (strncmp(at, "false", 5) == 0) at += 5;
            else return 0;
        } else {
            value = 0;
            if (*at < '0' || *at > '9') return 0;
            if (*at == '0' && at[1] >= '0' && at[1] <= '9') return 0;
            while (*at >= '0' && *at <= '9') {
                if (value > UINT64_C(900719925474099)) return 0;
                value = value * 10 + (unsigned)(*at++ - '0');
            }
            if (bit == 1) schema = value == 1;
            else expires = value;
        }
        skip_json_space(&at);
        if (*at == '}') { ++at; break; }
        if (*at++ != ',') return 0;
    }
    skip_json_space(&at);
    if (*at || fields != 7 || !schema || !enabled) return 0;
    GetSystemTimeAsFileTime(&ft);
    ticks.LowPart = ft.dwLowDateTime; ticks.HighPart = ft.dwHighDateTime;
    now = (ticks.QuadPart - UINT64_C(116444736000000000)) / 10000;
    return expires > now && expires - now <= 60000;
}

static int executable_export(FARPROC p) {
    MEMORY_BASIC_INFORMATION info;
    unsigned char bytes[16];
    size_t i;
    if (!p || !VirtualQuery((const void *)p, &info, sizeof(info)) ||
        info.State != MEM_COMMIT || (info.Protect & (PAGE_GUARD | PAGE_NOACCESS)) ||
        !(info.Protect & (PAGE_EXECUTE | PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY)))
        return 0;
    if (!read_self((const void *)p, bytes, sizeof(bytes))) return 0;
    for (i = 0; i < sizeof(bytes); ++i) if (bytes[i]) return 1;
    return 0;
}

static int load_api(HMODULE module) {
    static char missing_export[128];
#define LOAD_API(name, result, args) do { \
    FARPROC address = GetProcAddress(module, "il2cpp_" #name); \
    if (!executable_export(address)) { \
        snprintf(missing_export, sizeof(missing_export), "missing_or_unready_il2cpp_%s", #name); \
        return fail(missing_export); \
    } \
    api.name = (result (*) args)address; \
} while (0);
    GAKUMAS_IL2CPP_APIS(LOAD_API)
#undef LOAD_API
    object_header = api.object_header_size();
    array_header = api.array_object_header_size();
    array_length_offset = api.offset_of_array_length_in_array_object_header();
    if (object_header != sizeof(void *) * 2 || array_header < object_header + sizeof(void *) * 2 ||
        array_header > 128 || array_length_offset < object_header ||
        array_length_offset + sizeof(size_t) > array_header)
        return fail("unsupported_runtime_object_layout");
    return 1;
}

static void *find_manager_class(void *domain) {
    const void **assemblies;
    size_t count = 0, i;
    assemblies = api.domain_get_assemblies(domain, &count);
    if (!assemblies || count > 1024) return NULL;
    for (i = 0; i < count; ++i) {
        void *assembly;
        void *image;
        char name[160];
        if (!read_self(assemblies + i, &assembly, sizeof(assembly))) return NULL;
        image = api.assembly_get_image(assembly);
        if (!image || !copy_c_string(api.image_get_name(image), name, sizeof(name))) continue;
        if (strcmp(name, "Assembly-CSharp.dll") == 0 || strcmp(name, "Assembly-CSharp") == 0)
            return api.class_from_name(image, "Campus.Common.User", "UserDataManager");
    }
    return NULL;
}

static void *existing_manager(void *manager_class, Field *instance_field) {
    void *parent = api.class_get_parent(manager_class);
    void *data, *manager;
    Field instance;
    if (!parent || !api.class_is_inited(parent)) { fail("manager_class_not_initialized"); return NULL; }
    /* The actual closed generic parent owns this static storage. */
    instance = find_field(parent, "_instance");
    if (!instance.found || !(instance.flags & FIELD_STATIC) || (instance.flags & FIELD_LITERAL) ||
        instance.offset > 1024 * 1024 || !reference_kind(instance.kind)) {
        fail("manager_singleton_field_missing"); return NULL;
    }
    data = api.class_get_static_field_data(instance.owner);
    if (!data || !read_pointer(add_pointer(data, instance.offset), &manager) || !manager) {
        fail("waiting_for_normal_login"); return NULL;
    }
    if (!class_named(object_class(manager), "UserDataManager")) {
        fail("unexpected_manager_instance_type"); return NULL;
    }
    *instance_field = instance;
    return manager;
}

/* A stale object or metadata pointer must not turn a read into an app crash. */
static int guarded_capture(void *manager, CollectionResult *result, ObjectWriter writer) {
    if (InterlockedCompareExchange(&g_stop, 0, 0)) return fail("collector_stopping");
#ifdef _MSC_VER
    __try { return capture_collection(manager, result, writer); }
    __except (EXCEPTION_EXECUTE_HANDLER) { return fail("runtime_read_exception"); }
#else
    return capture_collection(manager, result, writer);
#endif
}

static void *guarded_domain(HMODULE module) {
#ifdef _MSC_VER
    __try {
#endif
        void *domain;
        if (!load_api(module)) return NULL;
        domain = api.domain_get();
        if (!domain) fail("waiting_for_runtime_domain");
        return domain;
#ifdef _MSC_VER
    } __except (EXCEPTION_EXECUTE_HANDLER) { fail("runtime_export_exception"); return NULL; }
#endif
}

static void *guarded_manager(void *domain, void **klass, Field *instance_field) {
#ifdef _MSC_VER
    __try {
#endif
        if (!*klass) *klass = find_manager_class(domain);
        if (!*klass) { fail("waiting_for_manager_type"); return NULL; }
        return existing_manager(*klass, instance_field);
#ifdef _MSC_VER
    } __except (EXCEPTION_EXECUTE_HANDLER) { fail("runtime_manager_read_exception"); return NULL; }
#endif
}

static void *guarded_thread_attach(void *domain) {
#ifdef _MSC_VER
    __try { return api.thread_attach(domain); }
    __except (EXCEPTION_EXECUTE_HANDLER) { return NULL; }
#else
    return api.thread_attach(domain);
#endif
}

static void guarded_thread_detach(void *thread) {
#ifdef _MSC_VER
    __try { api.thread_detach(thread); }
    __except (EXCEPTION_EXECUTE_HANDLER) { /* Runtime shutdown can already be underway. */ }
#else
    api.thread_detach(thread);
#endif
}

static int runtime_still_current(HMODULE module, void *domain) {
    if (InterlockedCompareExchange(&g_stop, 0, 0) ||
        GetModuleHandleW(L"GameAssembly.dll") != module) return 0;
#ifdef _MSC_VER
    __try { return api.domain_get() == domain; }
    __except (EXCEPTION_EXECUTE_HANDLER) { return 0; }
#else
    return api.domain_get() == domain;
#endif
}

static int manager_still_current(Field instance_field, void *manager) {
#ifdef _MSC_VER
    __try {
#endif
        void *data = api.class_get_static_field_data(instance_field.owner);
        void *current = NULL;
        return data && read_pointer(add_pointer(data, instance_field.offset), &current) && current == manager;
#ifdef _MSC_VER
    } __except (EXCEPTION_EXECUTE_HANDLER) { return 0; }
#endif
}

static uint64_t fingerprint(CollectionResult *results, int count) {
    uint64_t hash = UINT64_C(14695981039346656037);
    int i;
    size_t k;
    for (i = 0; i < count; ++i)
        for (k = 0; k < results[i].rows.len; ++k) {
            hash ^= (unsigned char)results[i].rows.data[k];
            hash *= UINT64_C(1099511628211);
        }
    return hash;
}

static int publish_snapshot(CollectionResult *results, CollectionResult *growth_panels) {
    Json j;
    char time[40];
    int i, ok;
    utc_now(time, sizeof(time));
    json_init(&j);
    json_text(&j, "{\"schemaVersion\":1,\"source\":\"gakumas-local-collector\",\"capturedAt\":");
    json_string(&j, time);
    json_text(&j, ",\"capture\":{\"status\":\"complete\",\"collections\":");
    collection_status_json(&j, results);
    json_text(&j, "},\"producerLevel\":null");
    for (i = 0; i < 4; ++i) {
        json_text(&j, ","); json_string(&j, results[i].name); json_text(&j, ":");
        json_bytes(&j, results[i].rows.data, results[i].rows.len);
    }
    json_text(&j, ",\"growthPanelCapture\":{\"status\":");
    json_string(&j, growth_panels->status);
    json_text(&j, ",\"expectedCount\":");
    if (growth_panels->expected < 0) json_text(&j, "null"); else json_number(&j, growth_panels->expected);
    json_text(&j, ",\"exportedCount\":"); json_number(&j, growth_panels->exported);
    json_text(&j, ",\"message\":"); json_string(&j, growth_panels->message);
    json_text(&j, "},\"userProduceGrowthPanelList\":");
    if (strcmp(growth_panels->status, "complete") == 0)
        json_bytes(&j, growth_panels->rows.data, growth_panels->rows.len);
    else json_text(&j, "null");
    json_text(&j, "}");
    ok = atomic_write(output_path, &j, 1);
    json_free(&j);
    return ok;
}

static void sleep_checked(DWORD milliseconds) {
    DWORD slept = 0;
    int requested = collection_requested();
    if (!requested && milliseconds > 1000) milliseconds = 1000;
    while (!InterlockedCompareExchange(&g_stop, 0, 0) && slept < milliseconds) {
        DWORD piece = milliseconds - slept;
        if (piece > 250) piece = 250;
        Sleep(piece); slept += piece;
        if (collection_requested() != requested) break;
    }
}

static DWORD WINAPI collector_worker(void *ignored) {
    HMODULE game_module = NULL;
    void *domain = NULL, *thread = NULL, *manager_class = NULL;
    uint64_t prior_fingerprint = 0;
    uint64_t prior_growth_fingerprint = 0;
    int have_prior = 0, runtime_wait_count = 0, prior_mode = -1;
    int have_growth_prior = 0;
    (void)ignored;
    if (!initialize_paths()) return 1;
    while (!InterlockedCompareExchange(&g_stop, 0, 0)) {
        CollectionResult results[4] = {
            { "userSupportCardList", "UserSupportCard", "<_userSupportCardList>k__BackingField", "waiting", "not_attempted", -1, 0, {0} },
            { "userIdolCardList", "UserIdolCard", "<_userIdolCardList>k__BackingField", "waiting", "not_attempted", -1, 0, {0} },
            { "userCharacterList", "UserCharacter", "<_userCharacterList>k__BackingField", "waiting", "not_attempted", -1, 0, {0} },
            { "userMemoryList", "UserMemory", "<_userMemoryList>k__BackingField", "waiting", "not_attempted", -1, 0, {0} }
        };
        ObjectWriter writers[4] = { write_support, write_idol, write_character, write_memory };
        CollectionResult growth_panels = {
            "userProduceGrowthPanelList", "UserProduceGrowthPanel", "<_userProduceGrowthPanelList>k__BackingField",
            "waiting", "not_attempted", -1, 0, {0}
        };
        Field instance_field;
        void *manager;
        int i, complete = 0, manager_current;
        uint64_t current_fingerprint;
        sampling_enabled = collection_requested();
        if (prior_mode != sampling_enabled) {
            prior_mode = sampling_enabled;
            have_prior = 0; have_growth_prior = 0;
            publish_status(sampling_enabled ? "waiting" : "paused", "control",
                           sampling_enabled ? "collection_explicitly_enabled" : "collection_disabled_saved_inventory_preserved", NULL);
        }
        /* Off means no IL2CPP API calls, including domain discovery/checks. */
        if (!sampling_enabled) { sleep_checked(1000); continue; }
        if (!domain) {
            game_module = GetModuleHandleW(L"GameAssembly.dll");
            /* Match the readiness point observed in Localify without a hook. */
            if (game_module && GetModuleHandleW(L"VuplexWebViewWindows.dll")) domain = guarded_domain(game_module);
            if (!domain) {
                if (++runtime_wait_count % 10 == 0)
                    publish_status("waiting", "runtime", !game_module ? "waiting_for_GameAssembly" :
                        !GetModuleHandleW(L"VuplexWebViewWindows.dll") ? "waiting_for_Vuplex_runtime_ready" : last_error, NULL);
                sleep_checked(1000); continue;
            }
        }
        /* Never keep an IL2CPP attachment across polling sleep or publication.
           A runtime can wait for registered threads before DLL_PROCESS_DETACH,
           so the detach notification cannot be our runtime cleanup signal. */
        if (!runtime_still_current(game_module, domain)) break;
        if (InterlockedCompareExchange(&g_stop, 0, 0)) break;
        if (!collection_requested()) continue;
        thread = guarded_thread_attach(domain);
        if (!thread) { publish_status("error", "thread", "runtime_thread_attach_failed", NULL); return 1; }
        if (InterlockedCompareExchange(&g_stop, 0, 0)) {
            guarded_thread_detach(thread);
            return 0;
        }
        manager = guarded_manager(domain, &manager_class, &instance_field);
        if (!manager) {
            guarded_thread_detach(thread);
            thread = NULL;
            publish_status("waiting", "login", last_error, NULL);
            have_prior = 0; have_growth_prior = 0; sleep_checked(interval_ms); continue;
        }
        for (i = 0; i < 4; ++i) {
            json_init(&results[i].rows);
            if (guarded_capture(manager, &results[i], writers[i])) ++complete;
            else {
                results[i].status = "error";
                snprintf(results[i].message, sizeof(results[i].message), "%s", last_error);
            }
        }
        json_init(&growth_panels.rows);
        if (guarded_capture(manager, &growth_panels, write_growth_panel)) {
            uint64_t current_growth_fingerprint = fingerprint(&growth_panels, 1);
            if (!have_growth_prior || current_growth_fingerprint != prior_growth_fingerprint) {
                prior_growth_fingerprint = current_growth_fingerprint;
                have_growth_prior = 1;
                growth_panels.status = "waiting";
                strcpy(growth_panels.message, "waiting_for_second_matching_snapshot");
            }
        } else {
            growth_panels.status = "error";
            snprintf(growth_panels.message, sizeof(growth_panels.message), "%s", last_error);
            have_growth_prior = 0;
        }
        manager_current = manager_still_current(instance_field, manager);
        guarded_thread_detach(thread);
        thread = NULL;
        if (InterlockedCompareExchange(&g_stop, 0, 0) || !collection_requested()) {
            for (i = 0; i < 4; ++i) json_free(&results[i].rows);
            json_free(&growth_panels.rows);
            if (InterlockedCompareExchange(&g_stop, 0, 0)) break;
            continue;
        }
        if (!manager_current) {
            publish_status("waiting", "login", "manager_replaced_during_read", results);
            have_prior = 0;
            have_growth_prior = 0;
        } else if (complete != 4) {
            publish_status("partial", "collections", "inventory_incomplete_last_snapshot_preserved", results);
            have_prior = 0;
        } else if (!results[1].expected) {
            /* Before normal login the constructor can create four empty containers. */
            publish_status("waiting", "login", "waiting_for_starter_idol_data", results);
            have_prior = 0;
        } else {
            current_fingerprint = fingerprint(results, 4);
            if (!have_prior || current_fingerprint != prior_fingerprint) {
                prior_fingerprint = current_fingerprint;
                have_prior = 1;
                publish_status("waiting", "stability", "waiting_for_second_matching_snapshot", results);
            } else if (publish_snapshot(results, &growth_panels)) {
                publish_status("complete", "snapshot", "inventory_saved", results);
            } else publish_status("error", "output", last_error, results);
        }
        for (i = 0; i < 4; ++i) json_free(&results[i].rows);
        json_free(&growth_panels.rows);
        sleep_checked(interval_ms);
    }
    return 0;
}

BOOL WINAPI DllMain(HINSTANCE module, DWORD reason, LPVOID reserved) {
    (void)reserved;
    if (reason == DLL_PROCESS_ATTACH) {
        /* Thread notifications may use a 64 KiB stack; keep this out of the frame. */
        static wchar_t path[PATH_CAP];
        wchar_t *name;
        DWORD length = GetModuleFileNameW(NULL, path, PATH_CAP);
        if (!length || length >= PATH_CAP) return TRUE;
        name = wcsrchr(path, L'\\');
        name = name ? name + 1 : path;
        if (lstrcmpiW(name, L"gakumas.exe") != 0) return TRUE;
        g_module = module;
        /* /MT needs CRT thread attach/detach notifications; do not disable them. */
        {
            HANDLE worker = CreateThread(NULL, 0, collector_worker, NULL, 0, NULL);
            if (worker) CloseHandle(worker);
        }
    } else if (reason == DLL_PROCESS_DETACH) {
        /* Loader lock is held: no wait/join, runtime calls, file I/O or cleanup.
           On process exit other threads can already have been terminated. */
        InterlockedExchange(&g_stop, 1);
    }
    return TRUE;
}

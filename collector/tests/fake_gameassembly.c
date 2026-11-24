/* Offline synthetic IL2CPP runtime. Never load this DLL into the real game. */
#define WIN32_LEAN_AND_MEAN
#define _CRT_SECURE_NO_WARNINGS
#include <windows.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include "../il2cpp_api.h"

typedef struct Meta Meta;
typedef struct Type { int32_t kind; Meta *klass; } Type;
typedef struct FieldDef { const char *name; Type *type; size_t offset; int32_t flags; } FieldDef;
struct Meta {
    const char *name, *namespaze;
    Meta *parent;
    FieldDef *fields;
    size_t field_count;
    void *statics;
    int is_enum;
    Meta *element;
    int32_t stride;
};
typedef struct Header { Meta *klass; void *monitor; } Header;
typedef struct Array { Header header; void *bounds; size_t length; unsigned char data[]; } Array;
typedef struct String { Header header; int32_t length; wchar_t chars[]; } String;
typedef struct Repeated { Header header; uint64_t deliberately_unused; Array *array; int32_t count; } Repeated;
typedef struct EntryOld { int32_t hashCode, next; String *key; void *value; uint64_t unused; } EntryOld;
typedef struct EntryNew { uint32_t hashCode; int32_t next; String *key; uint64_t unused; void *value; } EntryNew;
typedef struct Dictionary {
    Header header;
    uint64_t deliberately_unused;
    Array *entries;
    int32_t count, free_count, version;
} Dictionary;
typedef struct Collection { Header header; int32_t deliberately_unused; void *entries; } Collection;
typedef struct Wrapper { Header header; uint64_t deliberately_unused[3]; void *inner; } Wrapper;
typedef struct Manager {
    Header header;
    uint64_t deliberately_unused;
    Collection *support, *idol, *character, *memory, *growth_panels;
} Manager;
typedef struct StaticFields { Manager *instance; } StaticFields;
typedef struct Support {
    Header header;
    uint64_t deliberately_unused;
    String *id;
    int32_t level, uncap, stock;
} Support;
typedef struct Idol {
    Header header;
    uint64_t deliberately_unused;
    String *id;
    int32_t uncap, potential;
    int64_t prima_time;
} Idol;
typedef struct Character {
    Header header;
    uint64_t deliberately_unused;
    String *id;
    int32_t dearness;
    Repeated *true_ends;
} Character;
typedef struct Customize { Header header; String *id; int32_t count; } Customize;
typedef struct Card { Header header; uint64_t deliberately_unused; String *id; int32_t upgrades; Repeated *customizes; } Card;
typedef struct Ability { Header header; String *id; int32_t level; } Ability;
typedef struct GrowthPanel { Header header; uint64_t deliberately_unused; String *id; int32_t level; uint8_t enabled; } GrowthPanel;
typedef struct Memory {
    Header header;
    uint64_t deliberately_unused;
    String *id, *produce, *character, *idol;
    int32_t plan, phase, vocal, dance, visual, stamina;
    Card *card;
    Repeated *abilities, *exam_cards, *exam_items;
    uint8_t prima;
} Memory;

static Meta meta_string, meta_enum, meta_ref_array, meta_i32_array, meta_repeated;
static Meta meta_entry_old, meta_entry_new, meta_old_array, meta_new_array;
static Meta meta_dict_old, meta_dict_new, meta_collection_base;
static Meta meta_reactive, meta_readonly, meta_unsupported;
static Meta meta_support_collection, meta_idol_collection, meta_character_collection, meta_memory_collection;
static Meta meta_manager, meta_closed_parent, meta_support, meta_idol, meta_character, meta_memory;
static Meta meta_card, meta_customize, meta_ability;
static Meta meta_growth_panel_collection, meta_growth_panel;
static Type t_i4 = { TYPE_I4, NULL }, t_u4 = { TYPE_U4, NULL }, t_i8 = { TYPE_I8, NULL };
static Type t_boolean = { TYPE_BOOLEAN, NULL }, t_string = { TYPE_STRING, &meta_string };
static Type t_enum = { TYPE_VALUETYPE, &meta_enum }, t_object = { TYPE_CLASS, NULL };
static Type t_array = { TYPE_SZARRAY, &meta_ref_array }, t_repeat = { TYPE_CLASS, &meta_repeated };
static StaticFields static_fields;
static Manager *manager;
static Dictionary *memory_dictionary, *idol_dictionary;
static Wrapper *changing_wrapper;
static void *changing_child_a, *changing_child_b;
static GrowthPanel *growth_panel_a;
static int growth_panel_name_reads;
static int initialized, fixture_mode;
static int dummy_domain, dummy_thread, dummy_assembly, dummy_image;
static volatile LONG active_threads, attach_count, detach_count, late_attach_count;
static volatile LONG shutting_down, unattached_metadata_reads, domain_call_count;
static __declspec(thread) int fixture_attached;
static __declspec(thread) int delayed_memory_read;
static const void *assemblies[] = { &dummy_assembly };

#define F(S, M, N, T) { N, T, offsetof(S, M), 0 }
#define EF(S, M, N, T) { N, T, sizeof(Header) + offsetof(S, M), 0 }
static FieldDef repeated_fields[] = { F(Repeated, array, "array", &t_array), F(Repeated, count, "count", &t_i4) };
static FieldDef entry_old_fields[] = {
    EF(EntryOld, hashCode, "hashCode", &t_i4), EF(EntryOld, next, "next", &t_i4),
    EF(EntryOld, key, "key", &t_string), EF(EntryOld, value, "value", &t_object)
};
static FieldDef entry_new_fields[] = {
    EF(EntryNew, hashCode, "hashCode", &t_u4), EF(EntryNew, next, "next", &t_i4),
    EF(EntryNew, key, "key", &t_string), EF(EntryNew, value, "value", &t_object)
};
static FieldDef dictionary_old_fields[] = {
    F(Dictionary, entries, "entries", &t_array), F(Dictionary, count, "count", &t_i4),
    F(Dictionary, free_count, "freeCount", &t_i4), F(Dictionary, version, "version", &t_i4)
};
static FieldDef dictionary_new_fields[] = {
    F(Dictionary, entries, "_entries", &t_array), F(Dictionary, count, "_count", &t_i4),
    F(Dictionary, free_count, "_freeCount", &t_i4), F(Dictionary, version, "_version", &t_i4)
};
static FieldDef collection_fields[] = { F(Collection, entries, "_entries", &t_object) };
static FieldDef reactive_fields[] = { F(Wrapper, inner, "inner", &t_object) };
static FieldDef readonly_fields[] = { F(Wrapper, inner, "m_dictionary", &t_object) };
static FieldDef manager_fields[] = {
    F(Manager, support, "<_userSupportCardList>k__BackingField", &t_object),
    F(Manager, idol, "<_userIdolCardList>k__BackingField", &t_object),
    F(Manager, character, "<_userCharacterList>k__BackingField", &t_object),
    F(Manager, memory, "<_userMemoryList>k__BackingField", &t_object),
    F(Manager, growth_panels, "<_userProduceGrowthPanelList>k__BackingField", &t_object)
};
static FieldDef singleton_fields[] = { { "_instance", &t_object, offsetof(StaticFields, instance), FIELD_STATIC } };
static FieldDef support_fields[] = {
    F(Support, id, "supportCardId_", &t_string), F(Support, level, "level_", &t_i4),
    F(Support, uncap, "levelLimitRank_", &t_enum), F(Support, stock, "stockQuantity_", &t_i4)
};
static FieldDef idol_fields[] = {
    F(Idol, id, "idolCardId_", &t_string), F(Idol, uncap, "levelLimitRank_", &t_enum),
    F(Idol, potential, "potentialRank_", &t_enum), F(Idol, prima_time, "primaStellaUpgradedTime_", &t_i8)
};
static FieldDef character_fields[] = {
    F(Character, id, "characterId_", &t_string), F(Character, dearness, "dearnessPoint_", &t_i4),
    F(Character, true_ends, "trueEndProduceTypes_", &t_repeat)
};
static FieldDef customize_fields[] = { F(Customize, id, "id_", &t_string), F(Customize, count, "customizeCount_", &t_i4) };
static FieldDef card_fields[] = {
    F(Card, id, "id_", &t_string), F(Card, upgrades, "upgradeCount_", &t_i4), F(Card, customizes, "customizes_", &t_repeat)
};
static FieldDef ability_fields[] = { F(Ability, id, "id_", &t_string), F(Ability, level, "level_", &t_i4) };
static FieldDef growth_panel_fields[] = {
    F(GrowthPanel, id, "produceGrowthPanelId_", &t_string),
    F(GrowthPanel, level, "level_", &t_i4), F(GrowthPanel, enabled, "enable_", &t_boolean)
};
static FieldDef memory_fields[] = {
    F(Memory, id, "userMemoryId_", &t_string), F(Memory, produce, "produceId_", &t_string),
    F(Memory, character, "characterId_", &t_string), F(Memory, idol, "idolCardId_", &t_string),
    F(Memory, plan, "planType_", &t_enum), F(Memory, phase, "produceCardPhaseType_", &t_enum),
    F(Memory, vocal, "vocal_", &t_i4), F(Memory, dance, "dance_", &t_i4),
    F(Memory, visual, "visual_", &t_i4), F(Memory, stamina, "stamina_", &t_i4),
    F(Memory, card, "produceCard_", &t_object), F(Memory, abilities, "abilities_", &t_repeat),
    F(Memory, exam_cards, "examBattleProduceCards_", &t_repeat), F(Memory, exam_items, "examBattleProduceItemIds_", &t_repeat),
    F(Memory, prima, "isPrimaStella_", &t_boolean)
};

static void setup_meta(Meta *m, const char *name, const char *ns, Meta *parent, FieldDef *fields, size_t n) {
    memset(m, 0, sizeof(*m));
    m->name = name; m->namespaze = ns; m->parent = parent; m->fields = fields; m->field_count = n;
}

static void *new_object(size_t size, Meta *klass) {
    Header *h = (Header *)calloc(1, size);
    if (!h) ExitProcess(90);
    h->klass = klass;
    return h;
}

static String *new_string(const wchar_t *text) {
    size_t n = wcslen(text);
    String *s = (String *)new_object(offsetof(String, chars) + (n + 1) * sizeof(wchar_t), &meta_string);
    s->length = (int32_t)n;
    memcpy(s->chars, text, (n + 1) * sizeof(wchar_t));
    return s;
}

static Array *new_array(Meta *klass, size_t n) {
    Array *a = (Array *)new_object(offsetof(Array, data) + n * (size_t)klass->stride, klass);
    a->length = n;
    return a;
}

static Repeated *references(size_t n, void **objects) {
    Repeated *r = (Repeated *)new_object(sizeof(*r), &meta_repeated);
    r->array = new_array(&meta_ref_array, n);
    r->count = (int32_t)n;
    if (n) memcpy(r->array->data, objects, n * sizeof(void *));
    return r;
}

static Repeated *enum_values(void) {
    const int32_t values[] = { 1, 3 };
    Repeated *r = (Repeated *)new_object(sizeof(*r), &meta_repeated);
    r->array = new_array(&meta_i32_array, 2);
    r->count = 2;
    memcpy(r->array->data, values, sizeof(values));
    return r;
}

static Dictionary *dictionary(Meta *klass, int modern, size_t n, void **objects, int with_free_entry) {
    Dictionary *d = (Dictionary *)new_object(sizeof(*d), klass);
    size_t i;
    d->count = (int32_t)n + with_free_entry;
    d->free_count = with_free_entry;
    d->version = 7;
    d->entries = new_array(modern ? &meta_new_array : &meta_old_array, (size_t)d->count);
    for (i = 0; i < (size_t)d->count; ++i) {
        int is_free = with_free_entry && i == 1;
        size_t source = i - (with_free_entry && i > 1 ? 1 : 0);
        if (modern) {
            EntryNew *entry = &((EntryNew *)d->entries->data)[i];
            /* UINT32_MAX is an active hash here; signed-hash logic would drop it. */
            entry->hashCode = UINT32_MAX;
            entry->next = is_free ? -3 : -1;
            entry->value = is_free ? NULL : objects[source];
        } else {
            EntryOld *entry = &((EntryOld *)d->entries->data)[i];
            entry->hashCode = is_free ? -1 : (int32_t)(i + 10);
            entry->next = -1;
            entry->value = is_free ? NULL : objects[source];
        }
    }
    return d;
}

static Collection *collection(Meta *klass, Dictionary *d) {
    Collection *c = (Collection *)new_object(sizeof(*c), klass);
    c->entries = d;
    return c;
}

static Wrapper *wrapper(Meta *klass, void *inner) {
    Wrapper *w = (Wrapper *)new_object(sizeof(*w), klass);
    w->inner = inner;
    return w;
}

static void initialize_fixture(void) {
    Support *support_a, *support_b;
    Idol *idol;
    Character *character;
    Memory *memory;
    Customize *custom_a, *custom_b;
    Card *card, *exam_card;
    Ability *ability_a, *ability_b;
    void *items[3];
    if (initialized) return;
    initialized = 1;
    setup_meta(&meta_string, "String", "System", NULL, NULL, 0);
    setup_meta(&meta_enum, "FixtureEnum", "Fixture", NULL, NULL, 0); meta_enum.is_enum = 1;
    setup_meta(&meta_ref_array, "Object[]", "System", NULL, NULL, 0); meta_ref_array.stride = sizeof(void *);
    setup_meta(&meta_i32_array, "Int32[]", "System", NULL, NULL, 0); meta_i32_array.stride = sizeof(int32_t);
    setup_meta(&meta_repeated, "RepeatedField`1", "Google.Protobuf.Collections", NULL, repeated_fields, 2);
    setup_meta(&meta_entry_old, "Entry", "System.Collections.Generic", NULL, entry_old_fields, 4);
    setup_meta(&meta_entry_new, "Entry", "System.Collections.Generic", NULL, entry_new_fields, 4);
    setup_meta(&meta_old_array, "Entry[]", "System.Collections.Generic", NULL, NULL, 0);
    meta_old_array.element = &meta_entry_old; meta_old_array.stride = sizeof(EntryOld);
    setup_meta(&meta_new_array, "Entry[]", "System.Collections.Generic", NULL, NULL, 0);
    meta_new_array.element = &meta_entry_new; meta_new_array.stride = sizeof(EntryNew);
    setup_meta(&meta_dict_old, "Dictionary`2", "System.Collections.Generic", NULL, dictionary_old_fields, 4);
    setup_meta(&meta_dict_new, "Dictionary`2", "System.Collections.Generic", NULL, dictionary_new_fields, 4);
    setup_meta(&meta_reactive, "ReactiveDictionary`2", "UniRx", NULL, reactive_fields, 1);
    setup_meta(&meta_readonly, "ReadOnlyDictionary`2", "System.Collections.ObjectModel", NULL, readonly_fields, 1);
    setup_meta(&meta_unsupported, "ReactiveDictionary`2", "Fixture", NULL, reactive_fields, 1);
    setup_meta(&meta_collection_base, "UserDataCollectionBase`2", "Qua.UserDataManagement", NULL, collection_fields, 1);
    setup_meta(&meta_support_collection, "UserSupportCardCollection", "Campus.Common.User", &meta_collection_base, NULL, 0);
    setup_meta(&meta_idol_collection, "UserIdolCardCollection", "Campus.Common.User", &meta_collection_base, NULL, 0);
    setup_meta(&meta_character_collection, "UserCharacterCollection", "Campus.Common.User", &meta_collection_base, NULL, 0);
    setup_meta(&meta_memory_collection, "UserMemoryCollection", "Campus.Common.User", &meta_collection_base, NULL, 0);
    setup_meta(&meta_closed_parent, "UserDataManagerBase`1", "Campus.Common.User", NULL, singleton_fields, 1);
    meta_closed_parent.statics = &static_fields;
    setup_meta(&meta_manager, "UserDataManager", "Campus.Common.User", &meta_closed_parent, manager_fields, 4);
    setup_meta(&meta_support, "UserSupportCard", "Campus.Common.Proto.Client.Transaction", NULL, support_fields, 4);
    setup_meta(&meta_idol, "UserIdolCard", "Campus.Common.Proto.Client.Transaction", NULL, idol_fields, 4);
    setup_meta(&meta_character, "UserCharacter", "Campus.Common.Proto.Client.Transaction", NULL, character_fields, 3);
    setup_meta(&meta_memory, "UserMemory", "Campus.Common.Proto.Client.Transaction", NULL, memory_fields, 15);
    setup_meta(&meta_customize, "ProduceCardCustomize", "Campus.Common.Proto.Client.Common", NULL, customize_fields, 2);
    setup_meta(&meta_card, "ProduceCard", "Campus.Common.Proto.Client.Common", NULL, card_fields, 3);
    setup_meta(&meta_ability, "MemoryAbility", "Campus.Common.Proto.Client.Transaction", NULL, ability_fields, 2);
    setup_meta(&meta_growth_panel_collection, "UserProduceGrowthPanelCollection", "Campus.Common.User", &meta_collection_base, NULL, 0);
    setup_meta(&meta_growth_panel, "UserProduceGrowthPanel", "Campus.Common.Proto.Client.Transaction", NULL, growth_panel_fields, 3);

    manager = (Manager *)new_object(sizeof(*manager), &meta_manager);
    static_fields.instance = manager;
    support_a = (Support *)new_object(sizeof(*support_a), &meta_support);
    support_a->id = new_string(L"support-fixture-001"); support_a->level = 25; support_a->uncap = 2; support_a->stock = 3;
    support_b = (Support *)new_object(sizeof(*support_b), &meta_support);
    support_b->id = new_string(L"support-fixture-002"); support_b->level = 40; support_b->uncap = 4; support_b->stock = 0;
    items[0] = support_a; items[1] = support_b;
    manager->support = collection(&meta_support_collection, dictionary(&meta_dict_old, 0, 2, items, 1));

    idol = (Idol *)new_object(sizeof(*idol), &meta_idol);
    idol->id = new_string(L"p-idol-fixture-001"); idol->uncap = 2; idol->potential = 4;
    idol->prima_time = INT64_C(9007199254740993);
    items[0] = idol;
    idol_dictionary = dictionary(&meta_dict_new, 1, 1, items, 1);
    manager->idol = collection(&meta_idol_collection, idol_dictionary);

    character = (Character *)new_object(sizeof(*character), &meta_character);
    character->id = new_string(L"character-fixture-001"); character->dearness = 6240; character->true_ends = enum_values();
    items[0] = character;
    manager->character = collection(&meta_character_collection, dictionary(&meta_dict_old, 0, 1, items, 0));

    custom_a = (Customize *)new_object(sizeof(*custom_a), &meta_customize);
    custom_a->id = new_string(L"customize-fixture-a"); custom_a->count = 1;
    custom_b = (Customize *)new_object(sizeof(*custom_b), &meta_customize);
    custom_b->id = new_string(L"customize-fixture-b"); custom_b->count = 2;
    card = (Card *)new_object(sizeof(*card), &meta_card);
    card->id = new_string(L"skill-fixture-001"); card->upgrades = 1;
    items[0] = custom_a; items[1] = custom_b; card->customizes = references(2, items);
    exam_card = (Card *)new_object(sizeof(*exam_card), &meta_card);
    exam_card->id = new_string(L"skill-fixture-002"); exam_card->upgrades = 0; exam_card->customizes = references(0, NULL);
    ability_a = (Ability *)new_object(sizeof(*ability_a), &meta_ability);
    ability_a->id = new_string(L"ability-fixture-001"); ability_a->level = 4;
    ability_b = (Ability *)new_object(sizeof(*ability_b), &meta_ability);
    ability_b->id = new_string(L"ability-fixture-002"); ability_b->level = 2;
    memory = (Memory *)new_object(sizeof(*memory), &meta_memory);
    memory->id = new_string(L"memory-\xBA54\xBAA8\xB9AC-001");
    memory->produce = new_string(L"produce-fixture-hif"); memory->character = character->id; memory->idol = idol->id;
    memory->plan = 3; memory->phase = 2; memory->vocal = 1501; memory->dance = 2602;
    memory->visual = 1703; memory->stamina = 35; memory->prima = 1; memory->card = card;
    items[0] = ability_a; items[1] = ability_b; memory->abilities = references(2, items);
    items[0] = card; items[1] = exam_card; memory->exam_cards = references(2, items);
    items[0] = new_string(L"item-fixture-a"); items[1] = new_string(L"item-\xD55C\xAE00"); memory->exam_items = references(2, items);
    items[0] = memory;
    memory_dictionary = dictionary(&meta_dict_new, 1, 1, items, 0);
    manager->memory = collection(&meta_memory_collection, memory_dictionary);
}

/* Fault injection affects synthetic data only. Each mode runs in a new host. */
__declspec(dllexport) void fixture_set_mode(int mode) {
    initialize_fixture();
    fixture_mode = mode;
    if (mode == 1) static_fields.instance = NULL;
    else if (mode == 2) meta_support.field_count = 3;
    else if (mode == 4) { memory_dictionary->count = 0; memory_dictionary->free_count = 0; memory_dictionary->entries = NULL; }
    else if (mode == 5) { idol_dictionary->count = 0; idol_dictionary->free_count = 0; idol_dictionary->entries = NULL; }
    else if (mode == 6 || mode == 7) {
        manager->support->entries = wrapper(&meta_reactive, wrapper(&meta_readonly, manager->support->entries));
        manager->idol->entries = wrapper(&meta_readonly, wrapper(&meta_reactive, manager->idol->entries));
        manager->character->entries = wrapper(&meta_reactive, manager->character->entries);
        manager->memory->entries = wrapper(&meta_reactive, wrapper(&meta_readonly, manager->memory->entries));
        if (mode == 7) {
            changing_wrapper = (Wrapper *)manager->memory->entries;
            changing_child_a = changing_wrapper->inner;
            changing_child_b = wrapper(&meta_readonly, memory_dictionary);
        }
    } else if (mode == 8) manager->memory->entries = wrapper(&meta_unsupported, memory_dictionary);
    else if (mode == 9 || mode == 10 || mode == 11) {
        GrowthPanel *disabled = (GrowthPanel *)new_object(sizeof(*disabled), &meta_growth_panel);
        void *panels[2];
        growth_panel_a = (GrowthPanel *)new_object(sizeof(*growth_panel_a), &meta_growth_panel);
        growth_panel_a->id = new_string(L"growth-panel-fixture-active");
        growth_panel_a->level = 2; growth_panel_a->enabled = 1;
        disabled->id = new_string(L"growth-panel-fixture-disabled");
        disabled->level = 3; disabled->enabled = 0;
        panels[0] = growth_panel_a; panels[1] = disabled;
        manager->growth_panels = collection(&meta_growth_panel_collection,
            dictionary(&meta_dict_new, 1, mode == 11 ? 1 : 2, panels, 1));
        manager->growth_panels->entries = wrapper(&meta_reactive, manager->growth_panels->entries);
        meta_manager.field_count = 5;
        if (mode == 10) meta_growth_panel.field_count = 2;
    }
}

/* Synthetic registration models a shutdown waiting for attached readers. It
   does not claim to reproduce the current Unity implementation. */
__declspec(dllexport) void fixture_begin_shutdown(void) { InterlockedExchange(&shutting_down, 1); }
__declspec(dllexport) void fixture_thread_counts(LONG *active, LONG *attached, LONG *detached, LONG *late, LONG *unsafe_reads) {
    *active = InterlockedCompareExchange(&active_threads, 0, 0);
    *attached = InterlockedCompareExchange(&attach_count, 0, 0);
    *detached = InterlockedCompareExchange(&detach_count, 0, 0);
    *late = InterlockedCompareExchange(&late_attach_count, 0, 0);
    *unsafe_reads = InterlockedCompareExchange(&unattached_metadata_reads, 0, 0);
}
__declspec(dllexport) void *il2cpp_domain_get(void) {
    InterlockedIncrement(&domain_call_count);
    initialize_fixture();
    return InterlockedCompareExchange(&shutting_down, 0, 0) ? NULL : &dummy_domain;
}
__declspec(dllexport) LONG fixture_domain_call_count(void) { return InterlockedCompareExchange(&domain_call_count, 0, 0); }
__declspec(dllexport) void *il2cpp_thread_attach(void *domain) {
    (void)domain;
    if (InterlockedCompareExchange(&shutting_down, 0, 0)) {
        InterlockedIncrement(&late_attach_count); return NULL;
    }
    if (!fixture_attached) {
        fixture_attached = 1;
        delayed_memory_read = 0;
        InterlockedIncrement(&active_threads); InterlockedIncrement(&attach_count);
    }
    return &dummy_thread;
}
__declspec(dllexport) void il2cpp_thread_detach(void *thread) {
    (void)thread;
    if (fixture_attached) {
        fixture_attached = 0;
        InterlockedDecrement(&active_threads); InterlockedIncrement(&detach_count);
    }
}
__declspec(dllexport) const void **il2cpp_domain_get_assemblies(void *domain, size_t *count) {
    (void)domain;
    if (!fixture_attached) InterlockedIncrement(&unattached_metadata_reads);
    *count = 1; return assemblies;
}
__declspec(dllexport) void *il2cpp_assembly_get_image(const void *assembly) { (void)assembly; return &dummy_image; }
__declspec(dllexport) const char *il2cpp_image_get_name(const void *image) { (void)image; return "Assembly-CSharp.dll"; }
__declspec(dllexport) void *il2cpp_class_from_name(const void *image, const char *ns, const char *name) {
    (void)image;
    return strcmp(ns, "Campus.Common.User") == 0 && strcmp(name, "UserDataManager") == 0 ? &meta_manager : NULL;
}
__declspec(dllexport) void *il2cpp_class_from_type(const void *type) { return ((const Type *)type)->klass; }
__declspec(dllexport) void *il2cpp_class_get_parent(const void *klass) { return ((const Meta *)klass)->parent; }
__declspec(dllexport) void *il2cpp_class_get_fields(const void *klass, void **iterator) {
    const Meta *m = (const Meta *)klass;
    size_t index = (size_t)(uintptr_t)*iterator;
    if (!fixture_attached) InterlockedIncrement(&unattached_metadata_reads);
    if (index >= m->field_count) return NULL;
    *iterator = (void *)(uintptr_t)(index + 1);
    return &m->fields[index];
}
__declspec(dllexport) const char *il2cpp_class_get_name(const void *klass) {
    if (fixture_mode == 12 && klass == &meta_memory && !delayed_memory_read) {
        delayed_memory_read = 1; Sleep(600);
    }
    /* Deterministic mid-read change, exercising the real version consistency check. */
    if (fixture_mode == 3 && klass == &meta_memory) ++memory_dictionary->version;
    if (fixture_mode == 7 && klass == &meta_memory)
        changing_wrapper->inner = changing_wrapper->inner == changing_child_a ? changing_child_b : changing_child_a;
    if (fixture_mode == 11 && klass == &meta_growth_panel && growth_panel_name_reads++ % 2 == 0)
        growth_panel_a->level = growth_panel_a->level == 2 ? 3 : 2;
    return ((const Meta *)klass)->name;
}
__declspec(dllexport) const char *il2cpp_class_get_namespace(const void *klass) { return ((const Meta *)klass)->namespaze; }
__declspec(dllexport) void *il2cpp_class_get_static_field_data(const void *klass) { return ((const Meta *)klass)->statics; }
__declspec(dllexport) uint8_t il2cpp_class_is_inited(const void *klass) { return klass != NULL; }
__declspec(dllexport) uint8_t il2cpp_class_is_enum(const void *klass) { return (uint8_t)((const Meta *)klass)->is_enum; }
__declspec(dllexport) void *il2cpp_class_enum_basetype(const void *klass) { (void)klass; return &t_i4; }
__declspec(dllexport) void *il2cpp_class_get_element_class(const void *klass) { return ((const Meta *)klass)->element; }
__declspec(dllexport) const char *il2cpp_field_get_name(const void *field) { return ((const FieldDef *)field)->name; }
__declspec(dllexport) size_t il2cpp_field_get_offset(const void *field) { return ((const FieldDef *)field)->offset; }
__declspec(dllexport) void *il2cpp_field_get_type(const void *field) { return ((const FieldDef *)field)->type; }
__declspec(dllexport) int32_t il2cpp_field_get_flags(const void *field) { return ((const FieldDef *)field)->flags; }
__declspec(dllexport) int32_t il2cpp_type_get_type(const void *type) { return ((const Type *)type)->kind; }
__declspec(dllexport) size_t il2cpp_object_header_size(void) { return sizeof(Header); }
__declspec(dllexport) size_t il2cpp_array_object_header_size(void) { return offsetof(Array, data); }
__declspec(dllexport) size_t il2cpp_offset_of_array_length_in_array_object_header(void) { return offsetof(Array, length); }
__declspec(dllexport) int32_t il2cpp_array_element_size(const void *klass) { return ((const Meta *)klass)->stride; }

BOOL WINAPI DllMain(HINSTANCE module, DWORD reason, LPVOID reserved) {
    (void)module; (void)reason; (void)reserved;
    return TRUE;
}

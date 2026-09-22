# Unified survivor lifecycle/service/ABI validation: exactly one exported KWin
# effect plugin hosts the active border, group overlay, initial-maximize
# handoff, and Slice 1 drag oracle. No second effect, factory, or metadata.
#
# Required inputs:
#   SOURCE_FILE - activewindowborder.cpp
#   HEADER_FILE - activewindowborder.h
#   CMAKE_FILE  - CMakeLists.txt

if(NOT DEFINED SOURCE_FILE OR NOT DEFINED HEADER_FILE OR NOT DEFINED CMAKE_FILE)
    message(FATAL_ERROR "usage: cmake -DSOURCE_FILE=<file> -DHEADER_FILE=<file> -DCMAKE_FILE=<file> -P validate-unified-lifecycle.cmake")
endif()

file(READ "${SOURCE_FILE}" IMPL)
file(READ "${HEADER_FILE}" HEADER)
file(READ "${CMAKE_FILE}" CMAKE)

# Exactly one effect factory in the survivor, bound to the survivor metadata.
string(REGEX MATCHALL "KWIN_EFFECT_FACTORY" FACTORY_MATCHES "${IMPL}")
list(LENGTH FACTORY_MATCHES FACTORY_COUNT)
if(NOT FACTORY_COUNT EQUAL 1)
    message(FATAL_ERROR "unified lifecycle validation failed: expected exactly one KWIN_EFFECT_FACTORY, found ${FACTORY_COUNT}")
endif()
foreach(FACTORY_PART "ActiveWindowBorderEffect" "metadata.json")
    string(FIND "${IMPL}" "${FACTORY_PART}" FACTORY_PART_POS)
    if(FACTORY_PART_POS EQUAL -1)
        message(FATAL_ERROR "unified lifecycle validation failed: '${FACTORY_PART}' missing from survivor factory")
    endif()
endforeach()
foreach(SECOND_PLUGIN "DragOracleEffect" "dragoracle-metadata.json" "plasma-auto-tiler-drag-oracle")
    string(FIND "${IMPL}" "${SECOND_PLUGIN}" SECOND_IMPL_POS)
    if(NOT SECOND_IMPL_POS EQUAL -1)
        message(FATAL_ERROR "unified lifecycle validation failed: second-plugin residue '${SECOND_PLUGIN}' must not exist in survivor implementation")
    endif()
    string(FIND "${HEADER}" "${SECOND_PLUGIN}" SECOND_HEADER_POS)
    if(NOT SECOND_HEADER_POS EQUAL -1)
        message(FATAL_ERROR "unified lifecycle validation failed: second-plugin residue '${SECOND_PLUGIN}' must not exist in survivor header")
    endif()
endforeach()

# Exactly one D-Bus service/object pair per endpoint, each unregistered.
foreach(ENDPOINT "org.plasmaautotiler.ActiveBorder" "/org/plasmaautotiler/ActiveBorder" "org.plasmaautotiler.DragOracle" "/org/plasmaautotiler/DragOracle")
    string(FIND "${IMPL}" "${ENDPOINT}" ENDPOINT_POS)
    if(ENDPOINT_POS EQUAL -1)
        message(FATAL_ERROR "unified service validation failed: '${ENDPOINT}' not found")
    endif()
endforeach()
foreach(UNREG "unregisterObject" "unregisterService")
    string(REGEX MATCHALL "${UNREG}" UNREG_MATCHES "${IMPL}")
    list(LENGTH UNREG_MATCHES UNREG_COUNT)
    if(UNREG_COUNT LESS 2)
        message(FATAL_ERROR "unified service validation failed: expected independent '${UNREG}' for both endpoints, found ${UNREG_COUNT}")
    endif()
endforeach()

# Oracle verdict lifetime: copy before the D-Bus return, never a borrowed view.
string(FIND "${IMPL}" "drag_oracle_last_copy" COPY_POS)
if(COPY_POS EQUAL -1)
    message(FATAL_ERROR "unified ABI validation failed: LastVerdict must use drag_oracle_last_copy")
endif()
string(FIND "${IMPL}" "drag_oracle_last(" BORROW_POS)
if(NOT BORROW_POS EQUAL -1)
    message(FATAL_ERROR "unified ABI validation failed: borrowed drag_oracle_last must not be used across the D-Bus boundary")
endif()
foreach(FFI_SYMBOL "drag_oracle_record" "drag_oracle_last_copy")
    string(FIND "${IMPL}" "${FFI_SYMBOL}" FFI_POS)
    if(FFI_POS EQUAL -1)
        message(FATAL_ERROR "unified ABI validation failed: '${FFI_SYMBOL}' not found in survivor implementation")
    endif()
endforeach()
foreach(HEADER_TOKEN "drag_oracle_ffi.h" "m_oracleDbusObject" "m_oracleStartRects" "attachOracleWindow" "forgetOracleWindow" "onOracleDragStart" "onOracleDragFinish")
    string(FIND "${HEADER}" "${HEADER_TOKEN}" HEADER_TOKEN_POS)
    if(HEADER_TOKEN_POS EQUAL -1)
        message(FATAL_ERROR "unified ABI validation failed: '${HEADER_TOKEN}' missing from survivor header")
    endif()
endforeach()

# Exactly one oracle hookup set shared with the existing lifecycle: one
# stacking-order pass plus single windowAdded/closed/deleted connections that
# also drive the oracle start/finish state through the shared lambdas.
string(REGEX MATCHALL "stackingOrder" STACK_MATCHES "${IMPL}")
list(LENGTH STACK_MATCHES STACK_COUNT)
if(NOT STACK_COUNT EQUAL 1)
    message(FATAL_ERROR "unified lifecycle validation failed: expected exactly one stackingOrder pass, found ${STACK_COUNT}")
endif()
foreach(HOOK "attachOracleWindow" "forgetOracleWindow" "onOracleDragStart" "onOracleDragFinish" "windowStartUserMovedResized" "windowFinishUserMovedResized" "moveResizeGeometry")
    string(FIND "${IMPL}" "${HOOK}" HOOK_POS)
    if(HOOK_POS EQUAL -1)
        message(FATAL_ERROR "unified lifecycle validation failed: '${HOOK}' not found")
    endif()
endforeach()
foreach(WINDOW_HOOK "windowAdded" "windowClosed" "windowDeleted")
    string(REGEX MATCHALL "EffectsHandler::${WINDOW_HOOK}" WINDOW_HOOK_MATCHES "${IMPL}")
    list(LENGTH WINDOW_HOOK_MATCHES WINDOW_HOOK_COUNT)
    if(NOT WINDOW_HOOK_COUNT EQUAL 1)
        message(FATAL_ERROR "unified lifecycle validation failed: expected exactly one '${WINDOW_HOOK}' hookup shared with the oracle, found ${WINDOW_HOOK_COUNT}")
    endif()
endforeach()
# The oracle observation helper reads moveResizeGeometry only (no geometry
# fallback beside it); the border's own frameGeometry rendering path above is
# unrelated and untouched.
string(FIND "${IMPL}" "oracleMoveResizeRect" ORACLE_HELPER_POS)
if(ORACLE_HELPER_POS EQUAL -1)
    message(FATAL_ERROR "unified lifecycle validation failed: oracleMoveResizeRect helper missing")
endif()

# Rendering stays untouched: the two outlines plus the pass-through paint.
foreach(RENDER_TOKEN "m_borderItem" "m_groupItem" "paintScreen")
    string(FIND "${IMPL}" "${RENDER_TOKEN}" RENDER_POS)
    if(RENDER_POS EQUAL -1)
        message(FATAL_ERROR "unified rendering validation failed: '${RENDER_TOKEN}' not found")
    endif()
endforeach()
string(REGEX MATCHALL "OutlinedBorderItem" OUTLINE_MATCHES "${HEADER}")
list(LENGTH OUTLINE_MATCHES OUTLINE_COUNT)
if(NOT OUTLINE_COUNT EQUAL 2)
    message(FATAL_ERROR "unified rendering validation failed: expected exactly two OutlinedBorderItem members, found ${OUTLINE_COUNT}")
endif()

# CMake builds only the survivor effect plus the KCM: no second plugin target,
# factory source, standalone metadata, or validation script.
foreach(LEGACY_TOKEN "dragoracle.h" "dragoracle.cpp" "dragoracle-metadata.json" "validate-dragoracle.cmake" "native-effect-drag-oracle-validation" "EXPECTED_PLUGIN_ID=plasma-auto-tiler-drag-oracle" "kcoreaddons_add_plugin(plasma-auto-tiler-drag-oracle")
    string(FIND "${CMAKE}" "${LEGACY_TOKEN}" LEGACY_POS)
    if(NOT LEGACY_POS EQUAL -1)
        message(FATAL_ERROR "unified build validation failed: legacy token '${LEGACY_TOKEN}' must not remain in CMakeLists.txt")
    endif()
endforeach()
foreach(SURVIVOR_TOKEN "plasma-auto-tiler-active-border" "libgroup_highlight.a" "libdrag_oracle.a" "Qt6::DBus" "drag_oracle_ffi.h" "plasma-auto-tiler-drag-oracle-rs" "plasma-auto-tiler-drag-oracle-test-bin" "native-effect-drag-oracle-rs" "native-effect-unified-lifecycle")
    string(FIND "${CMAKE}" "${SURVIVOR_TOKEN}" SURVIVOR_POS)
    if(SURVIVOR_POS EQUAL -1)
        message(FATAL_ERROR "unified build validation failed: '${SURVIVOR_TOKEN}' missing from CMakeLists.txt")
    endif()
endforeach()

message(STATUS "unified lifecycle/service/ABI validation passed for ${SOURCE_FILE}")

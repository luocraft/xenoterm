#ifndef __LIBTSCAN_H
#define __LIBTSCAN_H

#include <iostream>
#include <windows.h>
#define byte  unsigned char
#define DLLIMPORT __declspec(dllimport)
#pragma pack(push)
#pragma pack(1)
#include <stdint.h>
typedef uint8_t u8;
typedef int8_t s8;
typedef uint16_t u16;
typedef int16_t s16;
typedef uint32_t u32;
typedef int32_t s32;
typedef uint64_t u64;
typedef int64_t s64;
typedef wchar_t wchar;
typedef struct _u8x8 { u8 d[8]; } u8x8;
typedef struct _u8x64 { u8 d[64]; } u8x64;
#define TSAPI(ret) __declspec(dllimport) ret __stdcall

typedef enum
{
	CHN1, CHN2, CHN3, CHN4, CHN5, CHN6, CHN7, CHN8,
	CHN9, CHN10, CHN11, CHN12, CHN13, CHN14, CHN15, CHN16,
	CHN17, CHN18, CHN19, CHN20, CHN21, CHN22, CHN23, CHN24,
	CHN25, CHN26, CHN27, CHN28, CHN29, CHN30, CHN31, CHN32
} APP_CHANNEL;

typedef enum : int
{
	lfdtCAN = 0,
	lfdtISOCAN = 1,
	lfdtNonISOCAN = 2
} TLIBCANFDControllerType;

typedef enum : int
{
	lfdmNormal = 0,
	lfdmACKOff = 1,
	lfdmRestricted = 2
} TLIBCANFDControllerMode;

typedef enum : byte
{
	ONLY_RX_MESSAGES,
	TX_RX_MESSAGES
} READ_TX_RX_DEF;

typedef union {
	u8 value;
	struct {
		u8 istx : 1;
		u8 remoteframe : 1;
		u8 extframe : 1;
		u8 tbd : 4;
		u8 iserrorframe : 1;
	} bits;
} TCANProperty;

typedef struct _TLIBCAN {
	u8 FIdxChn;
	TCANProperty FProperties;
	u8 FDLC;
	u8 FReserved;
	s32 FIdentifier;
	u64 FTimeUS;
	u8 FData[8];
} TLIBCAN, *PLibCAN;

typedef union {
	u8 value;
	struct {
		u8 EDL : 1;
		u8 BRS : 1;
		u8 ESI : 1;
		u8 tbd : 5;
	} bits;
} TCANFDProperty;

typedef struct _TLIBCANFD {
	u8 FIdxChn;
	TCANProperty FProperties;
	u8 FDLC;
	TCANFDProperty FFDProperties;
	s32 FIdentifier;
	u64 FTimeUS;
	u8 FData[64];
} TLIBCANFD, *PLibCANFD;

/* Callback types */
typedef void(__stdcall* TCANQueueEvent_Win32_t)(const PLibCANFD AData);
typedef void(__stdcall* TCANFDQueueEvent_Win32_t)(const PLibCANFD AData);

extern "C"
{
	/* Library init / finalize */
	TSAPI(void) initialize_lib_tscan(bool AEnableFIFO, bool AEnableErrorFrame, bool AUseHWTime);
	TSAPI(void) finalize_lib_tscan(void);

	/* Device scan & connect */
	TSAPI(u32) tscan_scan_devices(uint32_t* ADeviceCount);
	TSAPI(u32) tscan_get_device_info(const s32 ADeviceIndex, char** AFManufacturer, char** AFProduct, char** AFSerial);
	TSAPI(u32) tscan_connect(const char* ADeviceSerial, size_t* AHandle);
	TSAPI(u32) tscan_get_can_channel_count(const size_t AHandle, s32* ACount);
	TSAPI(u32) tscan_disconnect_by_handle(const size_t ADeviceHandle);
	TSAPI(u32) tscan_disconnect_all_devices(void);

	/* CAN config & transmit */
	TSAPI(u32) tscan_config_can_by_baudrate(const size_t ADeviceHandle, const APP_CHANNEL AChnIdx, const double ARateKbps, const u32 A120OhmConnected);
	TSAPI(u32) tscan_transmit_can_async(const size_t ADeviceHandle, const TLIBCAN* ACAN);
	TSAPI(u32) tscan_transmit_can_sync(const size_t ADeviceHandle, const TLIBCAN* ACAN, const u32 ATimeoutMS);

	/* CAN FD config & transmit */
	TSAPI(u32) tscan_config_canfd_by_baudrate(const size_t ADeviceHandle, const APP_CHANNEL AChnIdx, const double AArbRateKbps, const double ADataRateKbps, const TLIBCANFDControllerType AControllerType, const TLIBCANFDControllerMode AControllerMode, const u32 A120OhmConnected);
	TSAPI(u32) tscan_transmit_canfd_async(const size_t ADeviceHandle, const TLIBCANFD* ACAN);
	TSAPI(u32) tscan_transmit_canfd_sync(const size_t ADeviceHandle, const TLIBCANFD* ACAN, const u32 ATimeoutMS);

	/* FIFO receive */
	TSAPI(u32) tsfifo_receive_can_msgs(const size_t ADeviceHandle, TLIBCAN* ACANBuffers, s32* ACANBufferSize, u8 AChn, u8 ARXTX);
	TSAPI(u32) tsfifo_receive_canfd_msgs(const size_t ADeviceHandle, TLIBCANFD* ACANBuffers, s32* ACANBufferSize, u8 AChn, u8 ARXTX);
	TSAPI(u32) tsfifo_clear_canfd_receive_buffers(const size_t ADeviceHandle, const s32 AIdxChn);

	/* Event callbacks */
	TSAPI(u32) tscan_register_event_can(const size_t ADeviceHandle, const TCANQueueEvent_Win32_t ACallback);
	TSAPI(u32) tscan_unregister_event_can(const size_t ADeviceHandle, const TCANQueueEvent_Win32_t ACallback);
	TSAPI(u32) tscan_register_event_canfd(const size_t ADeviceHandle, const TCANFDQueueEvent_Win32_t ACallback);
	TSAPI(u32) tscan_unregister_event_canfd(const size_t ADeviceHandle, const TCANFDQueueEvent_Win32_t ACallback);

	/* Cyclic messages */
	TSAPI(u32) tscan_add_cyclic_msg_can(const size_t ADeviceHandle, const TLIBCAN* ACAN, const float APeriodMS);
	TSAPI(u32) tscan_delete_cyclic_msg_can(const size_t ADeviceHandle, const TLIBCAN* ACAN);
	TSAPI(u32) tscan_add_cyclic_msg_canfd(const size_t ADeviceHandle, const TLIBCANFD* ACANFD, const float APeriodMS);
	TSAPI(u32) tscan_delete_cyclic_msg_canfd(const size_t ADeviceHandle, const TLIBCANFD* ACANFD);

	/* Error description */
	TSAPI(u32) tscan_get_error_description(const u32 ACode, char** ADesc);
}
#pragma pack(pop)
#endif

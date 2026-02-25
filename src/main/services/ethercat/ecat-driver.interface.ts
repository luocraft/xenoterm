/**
 * EtherCAT 驱动接口 — 抽象 SOEM 和 Virtual 驱动
 */
import type { EcSlaveInfo, SdoResult, ErrorCounters, EmergencyMsg, FoeResult } from './types';

export interface EcatDriver {
  readonly name: string;
  isAvailable(): boolean;
  listAdapters(): { name: string; description: string }[];
  init(adapterName: string): void;
  configInit(): number;
  getSlaveCount(): number;
  getSlaveInfo(slaveIndex: number): EcSlaveInfo;
  writeState(slaveIndex: number, targetState: number): void;
  stateCheck(slaveIndex: number, targetState: number, timeoutUs?: number): number;
  sdoRead(slaveIndex: number, index: number, subIndex: number, size: number): SdoResult;
  sdoWrite(slaveIndex: number, index: number, subIndex: number, data: Buffer): SdoResult;
  sendProcessData(): void;
  receiveProcessData(timeoutUs?: number): number;
  getInputData(slaveIndex: number): Buffer;
  getOutputData(slaveIndex: number): Buffer;
  writeOutputData(slaveIndex: number, data: Buffer): void;
  getErrorCounters(slaveIndex: number): ErrorCounters;
  clearErrorCounters(slaveIndex: number): void;
  readEmergency(slaveIndex: number): EmergencyMsg | null;
  foeWrite(slaveIndex: number, filename: string, data: Buffer, password?: number): FoeResult;
  siiRead(slaveIndex: number, offset: number, size: number): number[];
  siiWrite(slaveIndex: number, offset: number, data: number[]): boolean;
  close(): void;
}

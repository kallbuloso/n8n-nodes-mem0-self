import type { IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription, ISupplyDataFunctions, SupplyData } from 'n8n-workflow';
export declare class Mem0Memory implements INodeType {
    description: INodeTypeDescription;
    supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData>;
    execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]>;
}
//# sourceMappingURL=Mem0Memory.node.d.ts.map
const _ = require("lodash");
const moment = require("moment");
const BarChart = require("./BarChart");
const LineChart = require("./LineChart");
const PieChart = require("./PieChart");
const determineType = require("../modules/determineType");
const dataFilter = require("./dataFilter");

moment.suppressDeprecationWarnings = true;

class AxisChart {
  constructor(data) {
    this.chart = data.chart;
    this.datasets = data.datasets;
    this.axisData = {
      x: [],
      y: [],
    };
    this.dateFormat = "";
  }

  plot(skipDataProcessing) {
    // skip the data processing if required (this algorithm is time-expensive)
    if (
      !skipDataProcessing
        || !this.chart.chartData
        || !this.chart.chartData.data
        || !this.chart.chartData.data.labels
        || !this.chart.chartData.data.datasets
    ) {
      const finalXAxisData = [];
      let gXType;

      // check if the global date filter should be on or off
      // the filter should work only if all the datasets have a dateField
      let canDateFilter = true;
      this.datasets.map((dataset) => {
        if (!dataset.options || !dataset.options.dateField) {
          canDateFilter = false;
        }
        return dataset;
      });

      for (let i = 0; i < this.datasets.length; i++) {
        const dataset = this.datasets[i];
        const { yAxisOperation, dateField } = dataset.options;
        let { xAxis, yAxis } = dataset.options;
        let xData;
        let yData;
        let yType;
        let xType;
        let xAxisData = [];
        let yAxisData = [];

        let filteredData = dataFilter(dataset.data, xAxis, dataset.options.conditions);

        if (dateField && this.chart.startDate && this.chart.endDate && canDateFilter) {
          let startDate = moment(this.chart.startDate);
          let endDate = moment(this.chart.endDate);

          if (this.chart.currentEndDate) {
            const timeDiff = endDate.diff(startDate, "days");
            endDate = moment().endOf("day");
            startDate = endDate.clone().subtract(timeDiff, "days").startOf("day");
          }

          const dateConditions = [{
            field: dateField,
            value: startDate,
            operator: "greaterOrEqual",
          }, {
            field: dateField,
            value: endDate,
            operator: "lessOrEqual",
          }];

          filteredData = dataFilter(filteredData, dateField, dateConditions);
        }

        // first, handle the xAxis
        if (xAxis.indexOf("root[]") > -1) {
          xAxis = xAxis.replace("root[].", "");
          // and data stays the same
          xData = filteredData;
        } else {
          const arrayFinder = xAxis.substring(0, xAxis.indexOf("]") - 1).replace("root.", "");
          xAxis = xAxis.replace("[]", "").replace("root.", "");
          xData = _.get(filteredData, arrayFinder);
        }

        let xAxisFieldName = xAxis;

        if (xAxisFieldName.indexOf(".") > -1) {
          xAxisFieldName = xAxisFieldName.substring(xAxisFieldName.lastIndexOf(".") + 1);
          xAxis = xAxisFieldName;
        }

        if (!(xData instanceof Array)) throw new Error("The X field is not part of an Array");
        xData.map((item) => {
          const xValue = _.get(item, xAxis);
          if (xValue) xType = determineType(xValue);
          xAxisData.push(xValue);
          return item;
        });
        gXType = xType;

        // X AXIS data processing
        switch (xType) {
          case "date":
            xAxisData = this.processDate(xAxisData, canDateFilter);
            break;
          case "number":
            xAxisData = this.processNumber(xAxisData);
            break;
          case "string":
            xAxisData = this.processString(xAxisData);
            break;
          case "boolean":
            xAxisData = this.processBoolean(xAxisData);
            break;
          case "object":
            xAxisData = this.processObject(xAxisData);
            break;
          case "array":
            xAxisData = this.processObject(xAxisData);
            break;
          default:
            xAxisData = this.processObject(xAxisData);
            break;
        }

        // now the yAxis
        if (yAxis.indexOf("root[]") > -1) {
          yAxis = yAxis.replace("root[].", "");
          // and data stays the same
          yData = filteredData;
        } else {
          const arrayFinder = yAxis.substring(0, yAxis.indexOf("]") - 1).replace("root.", "");
          yAxis = yAxis.substring(yAxis.indexOf("]") + 2);

          yData = _.get(filteredData, arrayFinder);
          yData = _.map(yData, yAxis);
        }

        if (!(yData instanceof Array)) throw new Error("The Y field is not part of an Array");
        yData.map((item, index) => {
          const yValue = _.get(item, yAxis);
          if (yValue) {
            yType = determineType(yValue);
            // only add the yValue if it corresponds to one of the x values found above
            if (_.indexOf(xAxisData.filtered, yData[index][xAxisFieldName]) > -1) {
              yAxisData.push({ x: yData[index][xAxisFieldName], y: yValue });
            } else if (xType === "date"
                && _.findIndex(
                  xAxisData.filtered,
                  (dateValue) => (
                    new Date(dateValue).getTime()
                      === new Date(yData[index][xAxisFieldName]).getTime()
                  )
                )) {
              yAxisData.push({ x: yData[index][xAxisFieldName], y: yValue });
            }
          } else {
            yType = determineType(item);
            yAxisData.push({ x: xData[index][xAxisFieldName], y: item });
          }
          return item;
        });

        // Y CHART data processing
        switch (yAxisOperation) {
          case "none":
            yAxisData = this.noOp(yAxisData);
            break;
          case "count":
            yAxisData = this.count(xAxisData.formatted);
            break;
          case "avg":
            yAxisData = this.sum(xAxisData.formatted, yAxisData, yType, true);
            break;
          case "sum":
            yAxisData = this.sum(xAxisData.formatted, yAxisData, yType);
            break;
          default:
            yAxisData = this.noOp(yAxisData);
            break;
        }

        // if the operation is count, make sure the xData has only unique values
        if (yAxisOperation === "none" && xType !== "date") {
          finalXAxisData.push(xAxisData.formatted);
        } else {
          finalXAxisData.push(_.uniq(xAxisData.formatted));
        }
        this.axisData.y.push(yAxisData);
      }

      const logObj = [];
      // group x & y values and eliminate duplicates on the X axis
      for (let i = 0; i < finalXAxisData.length; i++) {
        logObj[i] = {};
        for (let j = 0; j < finalXAxisData[i].length; j++) {
          if (!logObj[i][finalXAxisData[i][j]]) logObj[i][finalXAxisData[i][j]] = [];

          logObj[i][finalXAxisData[i][j]].push(this.axisData.y[i][j]);
        }
      }

      // now get all the keys and merge them in one array - this will help map the final X Axis
      let allKeys = [];
      logObj.map((item) => {
        Object.keys(item).forEach((key) => {
          allKeys.push(key);
        });

        return item;
      });

      if (gXType === "number") {
        allKeys = _.uniq(allKeys).sort();
      } else if (gXType === "date") {
        allKeys = _.uniq(allKeys).sort((a, b) => {
          return moment(a, this.dateFormat) - moment(b, this.dateFormat);
        });
      } else {
        allKeys = _.uniq(allKeys);
      }

      // now build each dataset matching keys from logObj and allKeys
      for (let i = 0; i < logObj.length; i++) {
        this.axisData.y[i] = [];
        let previousValue;
        for (const key of allKeys) {
          // add just the first element for now
          if (logObj[i][key]) {
            this.axisData.y[i].push(logObj[i][key][0]);
          } else if (this.chart.subType.indexOf("AddTimeseries") > -1 && previousValue) {
            this.axisData.y[i].push(previousValue);
          } else {
            this.axisData.y[i].push(0);
          }

          if (logObj[i][key]) {
            [previousValue] = logObj[i][key];
          }
        }
      }

      if (!this.dateFormat && this.chart.subType.indexOf("AddTimeseries") > -1) {
        for (let i = 0; i < this.axisData.y.length; i++) {
          let yAxisData = this.axisData.y[i];
          yAxisData = _.clone(yAxisData).map((item, index) => {
            let newItem = item;
            if (index > 0) newItem += yAxisData[index - 1];
            return newItem;
          });

          this.axisData.y[i] = yAxisData;
        }
      }

      this.axisData.x = allKeys;
    }

    if (skipDataProcessing) {
      // this.axisData = this.chart.chartData.data;
      this.axisData.x = this.chart.chartData.data.labels;
      this.chart.chartData.data.datasets.map((dataset) => {
        this.axisData.y.push(dataset.data);
        return dataset;
      });
    }

    let chart;
    switch (this.chart.type) {
      case "line":
        chart = new LineChart(this.chart, this.datasets, this.axisData);
        break;
      case "bar":
        chart = new BarChart(this.chart, this.datasets, this.axisData);
        break;
      default:
        chart = new PieChart(this.chart, this.datasets, this.axisData);
        break;
    }

    return chart.getConfiguration();
  }

  processDate(data, canDateFilter) {
    const finalData = {
      filtered: [],
      formatted: [],
    };

    let axisData = data;
    for (let i = 0; i < axisData.length; i++) {
      axisData[i] = moment(axisData[i]);
    }
    axisData = axisData.sort((a, b) => a.diff(b));

    // include all the missing dates when includeZeros is true
    if (this.chart.includeZeros) {
      // get the start date
      let startDate = axisData[0];
      let endDate = axisData[axisData.length - 1];

      if (canDateFilter && this.chart.startDate && this.chart.endDate) {
        startDate = moment(this.chart.startDate);
        endDate = moment(this.chart.endDate);

        if (this.chart.currentEndDate) {
          const timeDiff = endDate.diff(startDate, "days");
          endDate = moment().endOf("day");
          startDate = endDate.clone().subtract(timeDiff, "days").startOf("day");
        }
      }

      const newAxisData = [];
      // make a new array containing all the dates between startDate and endDate
      while (startDate.isBefore(endDate)) {
        newAxisData.push(startDate);

        for (let d = 0; d < axisData.length; d++) {
          if (axisData[d].isSame(startDate, this.chart.timeInterval)) {
            newAxisData.push(axisData[d]);
          }
        }

        startDate = startDate
          .clone()
          .add(1, this.chart.timeInterval).startOf(this.chart.timeInterval);
      }

      axisData = newAxisData;
    }

    finalData.filtered = _.clone(axisData);
    finalData.filtered = finalData.filtered.map((item) => item.format());

    const startDate = axisData[0];
    const endDate = axisData[axisData.length - 1];
    // format the dates
    for (let i = 0; i < axisData.length; i++) {
      switch (this.chart.timeInterval) {
        case "hour":
          if (this.dateFormat) {
            axisData[i] = axisData[i].format(this.dateFormat);
          } else if (startDate.year() !== endDate.year()) {
            this.dateFormat = "YYYY/MM/DD hA";
            axisData[i] = axisData[i].format(this.dateFormat);
          } else {
            this.dateFormat = "MMM Do hA";
            axisData[i] = axisData[i].format(this.dateFormat);
          }
          break;
        case "day":
          if (this.dateFormat) {
            axisData[i] = axisData[i].format(this.dateFormat);
          } else if (startDate.year() !== endDate.year()) {
            this.dateFormat = "YYYY MMM D";
            axisData[i] = axisData[i].format(this.dateFormat);
          } else {
            this.dateFormat = "MMM D";
            axisData[i] = axisData[i].format(this.dateFormat);
          }
          break;
        case "week":
          if (this.dateFormat) {
            axisData[i] = axisData[i].format(this.dateFormat);
          } else if (startDate.year() !== endDate.year()) {
            this.dateFormat = "YYYY MMM [w] w";
            axisData[i] = axisData[i].format(this.dateFormat);
          } else {
            this.dateFormat = "MMM [w] w";
            axisData[i] = axisData[i].format(this.dateFormat);
          }
          break;
        case "month":
          if (this.dateFormat) {
            axisData[i] = axisData[i].format(this.dateFormat);
          } else if (startDate.year() !== endDate.year()) {
            this.dateFormat = "MMM YYYY";
            axisData[i] = axisData[i].format(this.dateFormat);
          } else {
            this.dateFormat = "MMM";
            axisData[i] = axisData[i].format(this.dateFormat);
          }
          break;
        case "year":
          this.dateFormat = "YYYY";
          axisData[i] = axisData[i].format(this.dateFormat);
          break;
        default:
          this.dateFormat = "MMM D";
          axisData[i] = axisData[i].format(this.dateFormat);
          break;
      }
    }

    finalData.formatted = axisData;

    return finalData;
  }

  processNumber(data) {
    return {
      filtered: data,
      formatted: data,
    };
  }

  processString(data) {
    return {
      filtered: data,
      formatted: data,
    };
  }

  processBoolean(data) {
    return {
      filtered: data,
      formatted: data,
    };
  }

  processObject(data) {
    return {
      filtered: data,
      formatted: data,
    };
  }

  /* OPERATIONS */
  noOp(yData) {
    const finalData = [];
    yData.map((item, index) => {
      if (index > 0 && this.chart.includeZeros) {
        if (moment(item.x).diff(moment(yData[index - 1].x), this.chart.timeInterval) > 1) {
          if (index > 0 && this.chart.subType.indexOf("AddTimeseries") > -1) {
            finalData.push(finalData[index - 1]);
          } else {
            finalData.push(0);
          }
        }
      }

      if (index > 0 && this.chart.subType.indexOf("AddTimeseries") > -1) {
        finalData.push(item.y + finalData[index - 1]);
      } else {
        finalData.push(item.y);
      }
      return item;
    });
    return finalData;
  }

  count(xData) {
    // get the labels and appearance count
    const formattedData = {};
    for (const value of xData) {
      if (!formattedData[value] && formattedData[value] !== 0) {
        formattedData[value] = determineType(xData[0]) === "date" && this.chart.includeZeros ? 0 : 1;
      } else if (formattedData[value] >= 0) {
        formattedData[value] += 1;
      }
    }

    if (this.dateFormat && this.chart.subType.indexOf("AddTimeseries") > -1) {
      let previousKey;
      Object.keys(formattedData).map((key) => {
        if (previousKey) {
          formattedData[key] = formattedData[previousKey] + formattedData[key];
        }

        previousKey = key;
        return formattedData[key];
      });
    }

    const axisData = [];
    const uniqX = _.uniq(xData);
    for (let i = 0; i < uniqX.length; i++) {
      axisData.push({ x: uniqX[i], finalY: formattedData[uniqX[i]] });
    }

    const yData = [];
    axisData.map((item) => {
      yData.push(item.finalY);
      return item;
    });

    return yData;
  }

  sum(xData, yData, type, average) {
    if (type !== "number") {
      // use count instead
      return this.count(xData);
    }

    const formattedData = {};
    for (let i = 0; i < yData.length; i++) {
      if (i === 0 || !formattedData[yData[i].x]) {
        if (average) formattedData[yData[i].x] = [yData[i].y];
        else formattedData[yData[i].x] = yData[i].y;
      } else if (average) {
        formattedData[yData[i].x].push(yData[i].y);
      } else {
        formattedData[yData[i].x] += yData[i].y;
      }
    }

    const axisData = _.clone(yData);
    if (average) {
      Object.keys(formattedData).forEach((key) => {
        let avgValue = _.sum(formattedData[key]) / formattedData[key].length;
        if (Math.round(avgValue) !== avgValue) avgValue = avgValue.toFixed(2);
        axisData.find((item) => item.x == key).finalY = avgValue; // eslint-disable-line
      });
    } else {
      Object.keys(formattedData).forEach((key) => {
        axisData.find((item) => item.x == key).finalY = formattedData[key]; // eslint-disable-line
      });
    }

    const finalAxisData = [];
    axisData.map((item, index) => {
      if (item.finalY || item.finalY === 0) {
        if (index > 0 && this.chart.subType.indexOf("AddTimeseries") > -1) {
          finalAxisData.push(item.finalY + finalAxisData[index - 1]);
        } else {
          finalAxisData.push(item.finalY);
        }
      }
      return item;
    });

    return finalAxisData;
  }
}

module.exports = AxisChart;
